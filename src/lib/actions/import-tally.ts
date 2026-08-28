"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { db } from "@/lib/db"
import { answers, formFields, forms, submissions } from "@/lib/db/schema"
import { getDefaultWorkspace, getRequiredUser } from "@/lib/auth/session"
import { saveAiForm, updateFormSettings } from "@/lib/actions/forms"
import { importTallyFormFromUrl, TallyImportError } from "@/lib/import/tally-page"
import { planCsvImport } from "@/lib/import/tally-csv"
import type { EditorField } from "@/lib/builder/form-model"
import type { AiFieldType } from "@/lib/ai/form-schema"

/**
 * Migrating a Tally form into MakingFlow, in two steps the user can stop between.
 *
 * Step one takes a public form link and rebuilds the questions. Step two takes
 * the CSV Tally exports and fills in the responses. They are separate because
 * the second needs the first — the CSV's only join key is the question label,
 * so the form has to exist before its answers mean anything — and because
 * plenty of people only want the form.
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

  // Skip rows a previous run already wrote. Reading only the external ids keeps
  // this proportional to what was imported, not to the form's whole history.
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

  const fresh = plan.submissions.filter((s) => !s.externalId || !already.has(s.externalId))
  const duplicates = plan.submissions.length - fresh.length
  const pending = fresh.slice(0, MAX_SUBMISSIONS)
  const truncated = fresh.length - pending.length

  if (pending.length === 0) {
    return {
      success: true,
      imported: 0,
      duplicates,
      emptyRows: plan.emptyRows,
      truncated: 0,
      unmatched: plan.unmatched,
    }
  }

  try {
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK)
      await db.transaction(async (tx) => {
        const created = await tx
          .insert(submissions)
          .values(
            chunk.map((s) => ({
              formId,
              workspaceId: workspace.id,
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
    console.error("[importTallySubmissions] insert failed", err)
    return { success: false, error: "Couldn't save those responses. Please try again." }
  }

  updateTag(`form-${formId}`)
  revalidatePath(`/forms/${formId}`)
  revalidatePath(`/forms/${formId}/submissions`)
  revalidatePath("/forms")

  return {
    success: true,
    imported: pending.length,
    duplicates,
    emptyRows: plan.emptyRows,
    truncated,
    unmatched: plan.unmatched,
  }
}
