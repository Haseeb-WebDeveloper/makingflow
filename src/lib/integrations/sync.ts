import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  workspaceConnections,
  type AnswerValue,
  type GoogleSheetsIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  appendRow,
  deleteRow,
  getColumnValues,
  getSheetId,
  getValidAccessToken,
  DEFAULT_SHEET_NAME,
} from "@/lib/integrations/google"
import { createFormSheet, reconcileFormSheet } from "@/lib/integrations/sheets-provision"

/** Render any answer value as a single cell string. */
function cell(value: AnswerValue | undefined): string {
  if (value == null) return ""
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

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
    } else {
      // Grow columns for any new fields (and migrate old sheets to the id column).
      const reconciled = await reconcileFormSheet(conn, config, form.id)
      config = reconciled.config
      if (reconciled.changed && row) {
        await db
          .update(formIntegrations)
          .set({ config })
          .where(eq(formIntegrations.id, row.id))
      }
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
