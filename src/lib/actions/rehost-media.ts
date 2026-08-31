"use server"

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { db } from "@/lib/db"
import {
  answers,
  formFields,
  forms,
  submissions,
  uploads,
  type AnswerValue,
  type FieldConfig,
  type FormSettings,
  type FormTheme,
} from "@/lib/db/schema"
import { getDefaultWorkspace, getRequiredUser } from "@/lib/auth/session"
import { isOurs, isRehostable, rehostFromUrl, type RehostedAsset } from "@/lib/cloudinary/rehost"

/**
 * Bringing an imported form's files onto our own storage.
 *
 * An import copies the DEFINITION and the ANSWERS, but every file stays where
 * it was — a logo, an inline image and every CV a respondent uploaded all still
 * point at storage.tally.so. That is invisible until the Tally account is
 * closed, and then it is a permanent loss: the uploaded files ARE the job
 * applications we just spent a migration preserving.
 *
 * Run as a resumable sweep rather than one long job, for the same reason the
 * import is: one account here has 13,490 submissions, and no single request
 * should be asked to finish that. Each call does a bounded slice and returns a
 * cursor; the caller comes round again until there is nothing left.
 *
 * Idempotent — anything already on res.cloudinary.com is skipped, so running it
 * twice costs two queries and no uploads.
 */

/** Files per call. Cloudinary fetches each one itself, so this is wall-clock. */
const FILES_PER_CALL = 40

/** Concurrent fetches. Enough to be quick, not enough to look like an attack. */
const CONCURRENCY = 4

export type RehostResult =
  | {
      success: true
      /** Branding and content assets moved (logo, cover, inline images). */
      assets: number
      /** Respondent uploads moved. */
      files: number
      /** Assets we could not move — usually already deleted at the source. */
      failed: number
      /** Pass this back to continue, or null when the form is done. */
      cursor: string | null
    }
  | { success: false; error: string }

/** Run `task` over `items`, a few at a time. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await task(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Copy a form's media onto our Cloudinary account, rewriting what points at it.
 *
 * The first call (no cursor) also moves the form-level assets — logo, cover and
 * anything embedded in the success page — because those are a fixed handful and
 * doing them once up front keeps the resumable part purely about answers.
 */
export async function rehostFormMedia(
  formId: string,
  cursor?: string | null,
): Promise<RehostResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id, theme: forms.theme, settings: forms.settings })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  let assets = 0
  let failed = 0

  try {
    if (!cursor) {
      const moved = await rehostFormAssets(formId, workspace.id, form.theme, form.settings)
      assets = moved.moved
      failed += moved.failed
    }

    const batch = await rehostAnswerFiles(formId, workspace.id, cursor ?? null)
    failed += batch.failed

    if (assets > 0 || batch.files > 0) {
      updateTag(`form-${formId}`)
      revalidatePath(`/forms/${formId}`)
      revalidatePath(`/forms/${formId}/submissions`)
    }

    return { success: true, assets, files: batch.files, failed, cursor: batch.cursor }
  } catch (err) {
    console.error("[rehostFormMedia] failed", err)
    return { success: false, error: "Couldn't move those files. Please try again." }
  }
}

/** Logo, cover, inline image blocks and images embedded in the success page. */
async function rehostFormAssets(
  formId: string,
  workspaceId: string,
  theme: FormTheme | null,
  settings: FormSettings | null,
): Promise<{ moved: number; failed: number }> {
  let moved = 0
  let failed = 0

  const move = async (url: string | undefined | null): Promise<string | null> => {
    if (!isRehostable(url) || isOurs(url)) return null
    const asset = await rehostFromUrl(url as string, "formAssets")
    if (!asset) {
      failed += 1
      return null
    }
    await recordUpload(asset, workspaceId, formId, null)
    moved += 1
    return asset.secureUrl
  }

  const nextTheme: FormTheme = { ...(theme ?? {}) }
  const logo = await move(nextTheme.logoUrl)
  if (logo) nextTheme.logoUrl = logo
  const cover = await move(nextTheme.coverImageUrl)
  if (cover) nextTheme.coverImageUrl = cover

  // The success page is HTML, so its images are <img src="…"> rather than a column.
  const nextSettings: FormSettings = { ...(settings ?? {}) }
  if (nextSettings.successBody) {
    const sources = [...nextSettings.successBody.matchAll(/src="([^"]+)"/g)].map((m) => m[1])
    for (const src of new Set(sources)) {
      const url = await move(src)
      if (url) {
        nextSettings.successBody = nextSettings.successBody.split(src).join(url)
      }
    }
  }

  if (moved > 0) {
    await db.update(forms).set({ theme: nextTheme, settings: nextSettings }).where(eq(forms.id, formId))
  }

  // Image blocks keep their asset in the field's config.
  const imageFields = await db
    .select({ id: formFields.id, config: formFields.config })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), eq(formFields.type, "image"), isNull(formFields.deletedAt)))

  for (const field of imageFields) {
    const url = await move(field.config?.imageUrl)
    if (!url) continue
    const config: FieldConfig = { ...(field.config ?? {}), imageUrl: url }
    await db.update(formFields).set({ config }).where(eq(formFields.id, field.id))
  }

  return { moved, failed }
}

/** One bounded slice of the respondent uploads, newest id last. */
async function rehostAnswerFiles(
  formId: string,
  workspaceId: string,
  cursor: string | null,
): Promise<{ files: number; failed: number; cursor: string | null }> {
  const rows = await db
    .select({ id: answers.id, submissionId: answers.submissionId, value: answers.value })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.formId, formId),
        eq(answers.type, "file_upload"),
        cursor ? gt(answers.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(answers.id))
    .limit(FILES_PER_CALL)

  if (rows.length === 0) return { files: 0, failed: 0, cursor: null }

  let files = 0
  let failed = 0

  for (const row of rows) {
    const list = fileList(row.value)
    if (!list) continue

    const pending = list.filter((f) => isRehostable(f.url) && !isOurs(f.url))
    if (pending.length === 0) continue

    const results = await pool(pending, CONCURRENCY, (f) => rehostFromUrl(f.url, "submissions"))

    const replacements = new Map<string, RehostedAsset>()
    for (const [i, asset] of results.entries()) {
      if (asset) replacements.set(pending[i].url, asset)
      else failed += 1
    }
    if (replacements.size === 0) continue

    const nextFiles = list.map((f) => {
      const asset = replacements.get(f.url)
      return asset ? { ...f, url: asset.secureUrl } : f
    })

    for (const asset of replacements.values()) {
      await recordUpload(asset, workspaceId, formId, row.submissionId)
    }
    await db
      .update(answers)
      .set({ value: { ...(row.value as Record<string, unknown>), files: nextFiles } })
      .where(eq(answers.id, row.id))

    files += replacements.size
  }

  // A short page means this was the last one.
  const nextCursor = rows.length < FILES_PER_CALL ? null : rows[rows.length - 1].id
  return { files, failed, cursor: nextCursor }
}

type StoredFile = { name: string; url: string }

/** The `{ files: [...] }` shape a file_upload answer stores, or null. */
function fileList(value: AnswerValue): StoredFile[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const list = (value as { files?: unknown }).files
  if (!Array.isArray(list)) return null
  const out: StoredFile[] = []
  for (const item of list) {
    const f = item as { name?: unknown; url?: unknown }
    if (typeof f?.url !== "string" || !f.url) continue
    out.push({ name: typeof f.name === "string" ? f.name : "file", url: f.url })
  }
  return out.length > 0 ? out : null
}

/**
 * Record the asset so it counts toward the workspace's storage quota and gets
 * destroyed when the form or submission is deleted. Without this the file is on
 * our account but nothing knows it is there.
 */
async function recordUpload(
  asset: RehostedAsset,
  workspaceId: string,
  formId: string,
  submissionId: string | null,
): Promise<void> {
  await db.insert(uploads).values({
    workspaceId,
    formId,
    submissionId,
    storageKey: asset.publicId,
    url: asset.secureUrl,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
  })
}

export type PendingMediaResult =
  | { success: true; files: number; assets: number }
  | { success: false; error: string }

/** How much of a form still points at Tally — so the UI can offer the sweep. */
export async function countPendingMedia(formId: string): Promise<PendingMediaResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id, theme: forms.theme, settings: forms.settings })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  // Counted in SQL rather than by reading every answer back: a form here has
  // thousands, and this runs just to decide whether to show a button.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.formId, formId),
        eq(answers.type, "file_upload"),
        sql`${answers.value}::text LIKE '%storage.tally.so%'`,
      ),
    )

  let assets = 0
  for (const url of [form.theme?.logoUrl, form.theme?.coverImageUrl]) {
    if (isRehostable(url)) assets += 1
  }
  if (form.settings?.successBody) {
    assets += [...form.settings.successBody.matchAll(/src="([^"]+)"/g)].filter((m) =>
      isRehostable(m[1]),
    ).length
  }
  const imageFields = await db
    .select({ config: formFields.config })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), eq(formFields.type, "image"), isNull(formFields.deletedAt)))
  assets += imageFields.filter((f) => isRehostable(f.config?.imageUrl)).length

  return { success: true, files: count, assets }
}
