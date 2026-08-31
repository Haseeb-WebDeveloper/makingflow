"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { db } from "@/lib/db"
import { answers, formFields, forms, submissions } from "@/lib/db/schema"
import { getDefaultWorkspace, getRequiredUser } from "@/lib/auth/session"
import { saveAiForm, updateFormSettings } from "@/lib/actions/forms"
import { importTallyFormFromUrl } from "@/lib/import/tally-page"
import { TallyImportError, tallyErrorMessage } from "@/lib/import/tally-error"
import {
  fetchTallyFormFromApi,
  fetchTallySubmissions,
  listTallyForms,
  type TallyFormSummary,
} from "@/lib/import/tally-api"
import { planApiImport } from "@/lib/import/tally-answers"
import { planCsvImport, type ImportedSubmission } from "@/lib/import/tally-csv"
import type { SkippedBlock } from "@/lib/import/tally-blocks"
import type { EditorField } from "@/lib/builder/form-model"
import type { AiFieldType } from "@/lib/ai/form-schema"

/**
 * Migrating a Tally form into MakingFlow.
 *
 * There are two ways in, and which one a user takes depends on what they have.
 *
 * The PUBLIC-LINK path needs nothing but a share link, and works for anyone —
 * no Tally account, no key. It comes in two steps the user can stop between:
 * the link rebuilds the questions, then the CSV export fills in the responses.
 * Those are separate because the second needs the first (the CSV's only join
 * key is the question label, so the form has to exist before its answers mean
 * anything) and because plenty of people only want the form.
 *
 * The API-KEY path does both at once, and does the join better — see
 * ../import/tally-answers.ts. It also reaches private and unpublished forms,
 * and can list the whole account. The key is used for the length of one request
 * and never stored: Tally's keys are unscoped, so holding one would mean
 * holding delete rights over somebody's forms for as long as we kept it.
 */

/** Responses one import will write. Past this, the CSV is a data migration. */
const MAX_SUBMISSIONS = 2000

/** Rows per insert — one statement with 50k parameters is a different problem. */
const CHUNK = 250

export type ImportFormResult =
  | {
      success: true
      formId: string
      title: string
      fieldCount: number
      skipped: { type: string; label: string }[]
    }
  | { success: false; error: string }

/**
 * Rebuild a public Tally form here as a draft.
 *
 * Persists through `saveAiForm` rather than writing rows directly: it already
 * owns the form+fields transaction, the workspace scoping and the cache
 * invalidation, and a second writer would be a second thing to keep correct.
 */
export async function importTallyForm(url: string): Promise<ImportFormResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  let imported: Awaited<ReturnType<typeof importTallyFormFromUrl>>
  try {
    imported = await importTallyFormFromUrl(url)
  } catch (err) {
    // Every failure in the fetcher is one the user can act on, so its message is
    // the message — never flatten it into "something went wrong".
    if (err instanceof TallyImportError) return { success: false, error: err.message }
    console.error("[importTallyForm] failed", err)
    return { success: false, error: "Couldn't import that form. Please try again." }
  }

  const { form, skipped } = imported
  if (form.fields.length === 0) {
    return {
      success: false,
      error: "That form has no questions we can import yet — nothing was created.",
    }
  }

  const saved = await saveAiForm({ form })
  if (!saved.success) return { success: false, error: saved.error }

  // Settings live on the form row, not in the field list saveAiForm writes.
  if (form.settings && Object.keys(form.settings).length > 0) {
    await updateFormSettings(saved.id, {
      showProgressBar: form.settings.showProgressBar,
      redirectUrl: form.settings.redirectUrl ?? null,
    })
  }

  revalidatePath("/forms")
  return {
    success: true,
    formId: saved.id,
    title: form.title,
    fieldCount: form.fields.filter((f) => !CONTENT.has(f.type)).length,
    skipped,
  }
}

const CONTENT = new Set(["heading", "paragraph", "image", "embed", "page_break"])

export type ImportSubmissionsResult =
  | {
      success: true
      imported: number
      duplicates: number
      emptyRows: number
      truncated: number
      unmatched: string[]
    }
  | { success: false; error: string }

/**
 * Load a Tally CSV export into a form imported from that same Tally form.
 *
 * Idempotent on Tally's submission id, so re-uploading the same export — or a
 * later one containing the same rows — adds only what is new. Exports without
 * an id column can't be deduplicated; the UI says so before the upload.
 *
 * Note it writes past a form's `submissionLimit`: that limit closes a form to
 * NEW respondents (see public-form.ts), and refusing to carry someone's history
 * across because of it would be the wrong reading. The dialog only ever targets
 * the form it just created, which has no limit set.
 */
export async function importTallySubmissions(
  formId: string,
  csv: string,
): Promise<ImportSubmissionsResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const fieldRows = await db
    .select({
      id: formFields.id,
      type: formFields.type,
      label: formFields.label,
      options: formFields.options,
    })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)

  const fields: EditorField[] = fieldRows.map((f) => ({
    id: f.id,
    type: f.type as AiFieldType,
    label: f.label,
    required: false,
    options: f.options ?? undefined,
  }))

  let plan: ReturnType<typeof planCsvImport>
  try {
    plan = planCsvImport(csv, fields)
  } catch (err) {
    console.error("[importTallySubmissions] could not read the CSV", err)
    return { success: false, error: "We couldn't read that file. Is it the CSV Tally exported?" }
  }

  if (plan.submissions.length === 0) {
    const reason = plan.unmatched.length > 0
      ? "None of its columns matched this form's questions. Make sure it's the export for this form."
      : "That file has no responses in it."
    return { success: false, error: reason }
  }

  const written = await writeImportedSubmissions(formId, workspace.id, plan.submissions)
  if ("error" in written) return { success: false, error: written.error }

  return {
    success: true,
    imported: written.imported,
    duplicates: written.duplicates,
    emptyRows: plan.emptyRows,
    truncated: written.truncated,
    unmatched: plan.unmatched,
  }
}

/**
 * Write planned submissions, skipping what a previous run already wrote.
 *
 * Shared by both import paths, which is the point: deduplication, chunking, the
 * explicit timestamps and the cache invalidation are all things that have to be
 * right, and having one copy of them means having one thing to keep right.
 *
 * Idempotent on Tally's submission id, so re-importing the same form — or the
 * same CSV — adds only what is new. Sources that don't supply an id can't be
 * deduplicated, and the UI says so before the upload.
 */
async function writeImportedSubmissions(
  formId: string,
  workspaceId: string,
  planned: ImportedSubmission[],
): Promise<{ imported: number; duplicates: number; truncated: number } | { error: string }> {
  // Reading only the external ids keeps this proportional to what was imported,
  // not to the form's whole history.
  const seen = await db
    .select({ externalId: sql<string>`${submissions.meta}->'importedFrom'->>'externalId'` })
    .from(submissions)
    .where(
      and(
        eq(submissions.formId, formId),
        sql`${submissions.meta}->'importedFrom'->>'source' = 'tally'`,
      ),
    )
  const already = new Set(seen.map((s) => s.externalId).filter(Boolean))

  const fresh = planned.filter((s) => !s.externalId || !already.has(s.externalId))
  const duplicates = planned.length - fresh.length
  const pending = fresh.slice(0, MAX_SUBMISSIONS)
  const truncated = fresh.length - pending.length

  if (pending.length === 0) return { imported: 0, duplicates, truncated: 0 }

  try {
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK)
      await db.transaction(async (tx) => {
        const created = await tx
          .insert(submissions)
          .values(
            chunk.map((s) => ({
              formId,
              workspaceId,
              status: "completed" as const,
              // Explicit, not defaulted: dating every historical response to the
              // moment of import would flatten the insights charts it feeds.
              createdAt: s.submittedAt ?? new Date(),
              completedAt: s.submittedAt ?? new Date(),
              meta: {
                importedFrom: { source: "tally" as const, externalId: s.externalId ?? undefined },
              },
            })),
          )
          .returning({ id: submissions.id })

        const rows = chunk.flatMap((s, index) =>
          s.answers.map((a) => ({
            submissionId: created[index].id,
            fieldId: a.fieldId,
            question: a.question,
            type: a.type,
            value: a.value,
          })),
        )
        if (rows.length > 0) await tx.insert(answers).values(rows)
      })
    }
  } catch (err) {
    console.error("[writeImportedSubmissions] insert failed", err)
    return { error: "Couldn't save those responses. Please try again." }
  }

  updateTag(`form-${formId}`)
  revalidatePath(`/forms/${formId}`)
  revalidatePath(`/forms/${formId}/submissions`)
  revalidatePath("/forms")

  return { imported: pending.length, duplicates, truncated }
}

// ── API-key path ────────────────────────────────────────────────────────────

export type ListTallyFormsResult =
  | { success: true; forms: TallyFormSummary[] }
  | { success: false; error: string }

/**
 * Every form a Tally API key can see.
 *
 * The key arrives with the request and leaves with the response — nothing is
 * written down. That is not caution for its own sake: a Tally key carries the
 * same rights as the account, DELETE included, so storing one would mean taking
 * custody of the user's whole Tally account to save them a paste.
 */
export async function listTallyApiForms(apiKey: string): Promise<ListTallyFormsResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  try {
    return { success: true, forms: await listTallyForms(apiKey) }
  } catch (err) {
    if (!(err instanceof TallyImportError)) console.error("[listTallyApiForms] failed", err)
    return {
      success: false,
      error: tallyErrorMessage(err, "Couldn't reach Tally. Please try again."),
    }
  }
}

export type ImportApiResult =
  | {
      success: true
      formId: string
      title: string
      fieldCount: number
      skipped: SkippedBlock[]
      imported: number
      duplicates: number
      emptyRows: number
      unmatched: string[]
      /** The form has more responses than one import carries. Run it again. */
      moreInTally: boolean
      /** Set when the questions came over but the responses did not. */
      responsesError?: string
    }
  | { success: false; error: string }

/**
 * Import one Tally form, and optionally its responses, using an API key.
 *
 * One form per call rather than a whole account per call, so the client can
 * show real progress across a multi-form migration and no single request has to
 * finish an unbounded amount of work inside the route's time budget.
 *
 * Responses are best-effort ON PURPOSE. If the questions import and the
 * responses fail, the form is kept and the failure is reported alongside it —
 * throwing away a form the user can already see rebuilt, because a later step
 * timed out, would be the wrong trade. Re-running fills in what's missing:
 * the write deduplicates on Tally's submission id.
 */
export async function importTallyFormFromApiKey(
  apiKey: string,
  tallyFormId: string,
  withResponses: boolean,
): Promise<ImportApiResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  let parsed: Awaited<ReturnType<typeof fetchTallyFormFromApi>>
  try {
    parsed = await fetchTallyFormFromApi(apiKey, tallyFormId)
  } catch (err) {
    if (!(err instanceof TallyImportError)) console.error("[importTallyFormFromApiKey] failed", err)
    return {
      success: false,
      error: tallyErrorMessage(err, "Couldn't import that form. Please try again."),
    }
  }

  const { form, skipped, refs } = parsed
  if (form.fields.length === 0) {
    return {
      success: false,
      error: "That form has no questions we can import yet — nothing was created.",
    }
  }

  const saved = await saveAiForm({ form })
  if (!saved.success) return { success: false, error: saved.error }

  if (form.settings && Object.keys(form.settings).length > 0) {
    await updateFormSettings(saved.id, {
      showProgressBar: form.settings.showProgressBar,
      redirectUrl: form.settings.redirectUrl ?? null,
    })
  }

  const base = {
    success: true as const,
    formId: saved.id,
    title: form.title,
    fieldCount: form.fields.filter((f) => !CONTENT.has(f.type)).length,
    skipped,
    imported: 0,
    duplicates: 0,
    emptyRows: 0,
    unmatched: [] as string[],
    moreInTally: false,
  }
  if (!withResponses) return base

  try {
    const page = await fetchTallySubmissions(apiKey, tallyFormId)
    const plan = planApiImport(form.fields, refs, page.questions, page.submissions)
    const written = await writeImportedSubmissions(saved.id, workspace.id, plan.submissions)
    if ("error" in written) return { ...base, responsesError: written.error }

    return {
      ...base,
      imported: written.imported,
      duplicates: written.duplicates,
      emptyRows: plan.emptyRows,
      unmatched: plan.unmatched,
      moreInTally: page.truncated,
    }
  } catch (err) {
    if (!(err instanceof TallyImportError)) {
      console.error("[importTallyFormFromApiKey] responses failed", err)
    }
    return {
      ...base,
      responsesError: tallyErrorMessage(err, "Couldn't read that form's responses from Tally."),
    }
  }
}
