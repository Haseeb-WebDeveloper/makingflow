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

/**
 * Files per call, and how many at once.
 *
 * Measured on a real migration: one file takes about 1.7s for Cloudinary to
 * pull from Tally's storage. The waiting is Cloudinary fetching from Tally, so
 * concurrency costs us sockets and nothing else — 16 at a time gives roughly
 * nine files a second.
 *
 * 150 per call then puts a pass near 17s, comfortably inside the 60s route
 * budget it gets in production, while keeping the number of round trips (and
 * so the number of chances to be interrupted) low.
 */
const FILES_PER_CALL = 150
const CONCURRENCY = 16

/**
 * Concurrent answer updates.
 *
 * Kept below the pool's `max: 5` connections (src/lib/db) so a pass can't
 * starve the rest of the request of a connection while it writes.
 */
const DB_CONCURRENCY = 4

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

  // A short page means this was the last one.
  const nextCursor = rows.length < FILES_PER_CALL ? null : rows[rows.length - 1].id

  // Flatten every file in the batch into ONE queue before fetching.
  //
  // The obvious shape — loop the answers, pool each answer's files — gives a
  // concurrency of one, because a file_upload answer almost always holds
  // exactly one file: `min(CONCURRENCY, 1)`. That made the whole sweep strictly
  // sequential and no amount of raising CONCURRENCY changed it.
  const lists = rows.map((r) => fileList(r.value))
  const jobs: { row: number; url: string }[] = []
  lists.forEach((list, row) => {
    for (const f of list ?? []) {
      if (isRehostable(f.url) && !isOurs(f.url)) jobs.push({ row, url: f.url })
    }
  })
  if (jobs.length === 0) return { files: 0, failed: 0, cursor: nextCursor }

  const results = await pool(jobs, CONCURRENCY, (j) => rehostFromUrl(j.url, "submissions"))

  let failed = 0
  const byRow = new Map<number, Map<string, RehostedAsset>>()
  results.forEach((asset, i) => {
    if (!asset) {
      failed += 1
      return
    }
    const { row, url } = jobs[i]
    let m = byRow.get(row)
    if (!m) byRow.set(row, (m = new Map()))
    m.set(url, asset)
  })
  if (byRow.size === 0) return { files: 0, failed, cursor: nextCursor }

  // Record the assets first, in one statement: an uploads row without a
  // rewritten answer is a harmless orphan, where the reverse would be a file on
  // our storage that nothing knows about and no quota counts.
  const uploadRows = []
  for (const [row, replacements] of byRow) {
    for (const a of replacements.values()) {
      uploadRows.push({
        workspaceId,
        formId,
        submissionId: rows[row].submissionId,
        storageKey: a.publicId,
        url: a.secureUrl,
        fileName: a.fileName,
        mimeType: a.mimeType,
        bytes: a.bytes,
      })
    }
  }
  await db.insert(uploads).values(uploadRows)

  // Run the updates CONCURRENTLY rather than as one hand-written statement.
  //
  // Sequential was the real bottleneck: against a remote database a round trip
  // is a large fraction of a second, so 150 of them cost far more than the
  // uploads they record. A single `UPDATE … FROM (VALUES …)` would be faster
  // still, but binding a JSON string and casting it to jsonb stores a jsonb
  // STRING, not an object — `jsonb_array_length(value->'files')` comes back
  // null — which would have quietly destroyed every file answer it touched.
  // Drizzle's own column mapper gets this right, so this keeps the mapper and
  // buys the speed from concurrency instead.
  let files = 0
  const patches: { id: string; value: AnswerValue }[] = []
  for (const [row, replacements] of byRow) {
    const list = lists[row] ?? []
    const nextFiles = list.map((f) => {
      const asset = replacements.get(f.url)
      return asset ? { ...f, url: asset.secureUrl } : f
    })
    patches.push({
      id: rows[row].id,
      value: { ...(rows[row].value as Record<string, unknown>), files: nextFiles },
    })
    files += replacements.size
  }

  await pool(patches, DB_CONCURRENCY, (p) =>
    db.update(answers).set({ value: p.value }).where(eq(answers.id, p.id)),
  )

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

export type PendingMediaForm = {
  id: string
  title: string
  /** Respondent uploads still hosted elsewhere. */
  files: number
  /** Logo, cover, inline images and success-page images still hosted elsewhere. */
  assets: number
}

export type PendingFormsResult =
  | { success: true; forms: PendingMediaForm[] }
  | { success: false; error: string }

/**
 * Every form in the workspace still pointing at Tally, worst first.
 *
 * The per-form sweep is the right unit of work but the wrong unit of effort:
 * a real migration here left 13,393 files across 68 forms, and asking someone
 * to visit 68 settings pages before they can close their old account is not an
 * answer. This is the discovery half — run once, then the caller walks the list
 * through `rehostFormMedia`, which already knows how to resume.
 */
export async function listPendingMediaForms(): Promise<PendingFormsResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const TALLY = "%tally.so%"

  // Wrapped so a failure here reaches the UI as a message. Uncaught, this
  // rejects the action, the card renders nothing, and a whole migration looks
  // like it simply did not happen.
  try {
  const [formRows, fileRows, imageRows] = await Promise.all([
    db
      .select({
        id: forms.id,
        title: forms.title,
        theme: forms.theme,
        settings: forms.settings,
      })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt))),

    // Grouped rather than counted per form: one pass over the uploads instead
    // of one query per form.
    db
      .select({ formId: submissions.formId, n: sql<number>`count(*)::int` })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(
        and(
          eq(submissions.workspaceId, workspace.id),
          eq(answers.type, "file_upload"),
          sql`${answers.value}::text like ${TALLY}`,
        ),
      )
      .groupBy(submissions.formId),

    db
      .select({ formId: formFields.formId, n: sql<number>`count(*)::int` })
      .from(formFields)
      .innerJoin(forms, eq(forms.id, formFields.formId))
      .where(
        and(
          eq(forms.workspaceId, workspace.id),
          eq(formFields.type, "image"),
          isNull(formFields.deletedAt),
          sql`${formFields.config}->>'imageUrl' like ${TALLY}`,
        ),
      )
      .groupBy(formFields.formId),
  ])

  const fileCount = new Map(fileRows.map((r) => [r.formId, r.n]))
  const imageCount = new Map(imageRows.map((r) => [r.formId, r.n]))

  const out: PendingMediaForm[] = []
  for (const f of formRows) {
    let assets = imageCount.get(f.id) ?? 0
    if (isRehostable(f.theme?.logoUrl)) assets += 1
    if (isRehostable(f.theme?.coverImageUrl)) assets += 1
    if (f.settings?.successBody) {
      assets += [...f.settings.successBody.matchAll(/src="([^"]+)"/g)].filter((m) =>
        isRehostable(m[1]),
      ).length
    }
    const files = fileCount.get(f.id) ?? 0
    if (files + assets > 0) {
      out.push({ id: f.id, title: f.title, files, assets })
    }
  }

  // Biggest first, so the bulk of the risk is gone earliest if the run is
  // interrupted.
  out.sort((a, b) => b.files + b.assets - (a.files + a.assets))
  return { success: true, forms: out }
  } catch (err) {
    console.error("[listPendingMediaForms] failed", err)
    return { success: false, error: "Couldn't check which files still need moving." }
  }
}
