import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  answers,
  formIntegrations,
  submissions,
  workspaceConnections,
  type AnswerValue,
  type GoogleSheetsIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  appendRow,
  appendRows,
  deleteRow,
  getColumnValues,
  getSheetId,
  getValidAccessToken,
  DEFAULT_SHEET_NAME,
} from "@/lib/integrations/google"
import { createFormSheet, reconcileFormSheet } from "@/lib/integrations/sheets-provision"
import { answerToCell as cell } from "@/lib/submissions/answer-format"

/** The workspace's Google connection (the global Sheets on-switch), or null. */
async function googleConnection(workspaceId: string): Promise<WorkspaceConnection | null> {
  const [conn] = await db
    .select()
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspaceId),
        eq(workspaceConnections.provider, "google"),
      ),
    )
    .limit(1)
  return conn ?? null
}

/** This form's google_sheets integration row (enabled or not), or null. */
async function sheetIntegration(formId: string) {
  const [row] = await db
    .select()
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)
  return row ?? null
}

/**
 * Best-effort: deliver one submission to Google Sheets under the GLOBAL model.
 *
 * The workspace Google connection is the on-switch — if it exists, every form
 * syncs automatically. A form's spreadsheet is created LAZILY here on its first
 * response. A form can be individually paused (a disabled `form_integrations`
 * row). On every sync the sheet is reconciled to the form first, so newly added
 * questions show up as columns automatically.
 *
 * Called AFTER the submission commits; it must never throw into the submit path
 * — a Sheets outage can't block a respondent.
 */
export async function syncSubmissionToSheets(
  form: { id: string; workspaceId: string; title: string },
  answers: { fieldId: string; value: AnswerValue }[],
  submittedAt: Date,
  submissionId: string,
): Promise<void> {
  try {
    const conn = await googleConnection(form.workspaceId)
    if (!conn) return

    const row = await sheetIntegration(form.id)
    if (row && !row.enabled) return // explicitly paused for this form

    let config = row?.config as GoogleSheetsIntegrationConfig | undefined

    if (!config) {
      // First response since the workspace connected — provision now and store it.
      config = await createFormSheet(conn, form.id, form.title)
      await db.insert(formIntegrations).values({
        formId: form.id,
        workspaceId: form.workspaceId,
        type: "google_sheets",
        enabled: true,
        config,
      })
      // The sheet is brand-new. Write EVERY completed response (this one
      // included, as it's already committed) so connecting Sheets after
      // responses exist backfills the history — not just rows from now on.
      await backfillFormSheet(conn, config, form.id)
      return
    }

    // Grow columns for any new fields (and migrate old sheets to the id column).
    const reconciled = await reconcileFormSheet(conn, config, form.id)
    config = reconciled.config
    if (reconciled.changed && row) {
      await db
        .update(formIntegrations)
        .set({ config })
        .where(eq(formIntegrations.id, row.id))
    }

    const accessToken = await getValidAccessToken(conn)
    const answerByField = new Map(answers.map((a) => [a.fieldId, a.value]))
    const columns = config.columns ?? []
    const cells = [
      submittedAt.toISOString(),
      ...columns.map((c) => cell(answerByField.get(c.fieldId))),
    ]
    // Lead with the submission id when the sheet tracks it (so the row can later
    // be found and deleted); legacy sheets without it just get the data columns.
    const values = config.hasIdColumn ? [submissionId, ...cells] : cells
    await appendRow(accessToken, config.spreadsheetId, config.sheetName ?? DEFAULT_SHEET_NAME, values)
  } catch (err) {
    console.error("[sync] google sheets delivery failed", err)
  }
}

/**
 * Bulk-deliver every completed submission a form already has into its sheet.
 * Runs when Sheets is connected/enabled AFTER responses exist, so the sheet
 * shows the full history rather than only rows that arrive from then on.
 *
 * Idempotent: rows whose Submission ID is already present (column A) are skipped,
 * so it's safe to run again (e.g. re-enabling a form). Requires the id-column
 * layout to dedup — a no-op on legacy sheets that lack it. Returns how many rows
 * it wrote; never throws into the caller.
 */
export async function backfillFormSheet(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<number> {
  try {
    if (!config.spreadsheetId || !config.hasIdColumn) return 0
    const accessToken = await getValidAccessToken(conn)
    const sheetName = config.sheetName ?? DEFAULT_SHEET_NAME

    // Submission ids already in the sheet (skip the header at index 0) so a
    // re-run never duplicates a row.
    const present = new Set(
      (await getColumnValues(accessToken, config.spreadsheetId, sheetName, "A")).slice(1),
    )

    const subs = await db
      .select({
        id: submissions.id,
        completedAt: submissions.completedAt,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(and(eq(submissions.formId, formId), eq(submissions.status, "completed")))
      .orderBy(submissions.createdAt)

    const pending = subs.filter((s) => !present.has(s.id))
    if (pending.length === 0) return 0

    // Load all answers for the pending submissions in one query, indexed by
    // submission → field. AI follow-ups (null fieldId) have no column, so skip.
    const answerRows = await db
      .select({
        submissionId: answers.submissionId,
        fieldId: answers.fieldId,
        value: answers.value,
      })
      .from(answers)
      .where(inArray(answers.submissionId, pending.map((s) => s.id)))

    const bySubmission = new Map<string, Map<string, AnswerValue>>()
    for (const a of answerRows) {
      if (!a.fieldId) continue
      let fields = bySubmission.get(a.submissionId)
      if (!fields) bySubmission.set(a.submissionId, (fields = new Map()))
      fields.set(a.fieldId, a.value)
    }

    const columns = config.columns ?? []
    const values = pending.map((s) => {
      const byField = bySubmission.get(s.id) ?? new Map<string, AnswerValue>()
      const submittedAt = (s.completedAt ?? s.createdAt).toISOString()
      return [s.id, submittedAt, ...columns.map((c) => cell(byField.get(c.fieldId)))]
    })

    await appendRows(accessToken, config.spreadsheetId, sheetName, values)
    return values.length
  } catch (err) {
    console.error("[sync] google sheets backfill failed", err)
    return 0
  }
}

/**
 * Best-effort: remove a submission's row from its Google Sheet (called when the
 * owner deletes the submission in MakingFlow). Finds the row by its id in the
 * leading Submission ID column. No-op for paused forms, disconnected workspaces,
 * or legacy sheets that predate id tracking. Never throws into the caller.
 */
export async function deleteSubmissionFromSheet(
  form: { id: string; workspaceId: string },
  submissionId: string,
): Promise<void> {
  try {
    const conn = await googleConnection(form.workspaceId)
    if (!conn) return

    const row = await sheetIntegration(form.id)
    if (!row || !row.enabled) return
    const config = row.config as GoogleSheetsIntegrationConfig
    if (!config?.spreadsheetId || !config.hasIdColumn) return // can't locate the row

    const accessToken = await getValidAccessToken(conn)
    const sheetName = config.sheetName ?? DEFAULT_SHEET_NAME

    let sheetId = config.sheetId ?? null
    if (sheetId == null) sheetId = await getSheetId(accessToken, config.spreadsheetId, sheetName)
    if (sheetId == null) return // no way to target the row for deletion

    // Column A holds the submission ids (incl. the header at index 0).
    const ids = await getColumnValues(accessToken, config.spreadsheetId, sheetName, "A")
    const rowIndex = ids.findIndex((v, i) => i > 0 && v === submissionId)
    if (rowIndex < 0) return // already gone, or never synced

    await deleteRow(accessToken, config.spreadsheetId, sheetId, rowIndex)
  } catch (err) {
    console.error("[sync] google sheets row deletion failed", err)
  }
}
