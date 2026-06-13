import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  workspaceConnections,
  type AnswerValue,
  type GoogleSheetsIntegrationConfig,
} from "@/lib/db/schema"
import { appendRow, getValidAccessToken, DEFAULT_SHEET_NAME } from "@/lib/integrations/google"
import { createFormSheet } from "@/lib/integrations/sheets-provision"

/** Render any answer value as a single cell string. */
function cell(value: AnswerValue | undefined): string {
  if (value == null) return ""
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/**
 * Best-effort: deliver one submission to Google Sheets under the GLOBAL model.
 *
 * The workspace Google connection is the on-switch — if it exists, every form
 * syncs automatically. A form's spreadsheet is created LAZILY here on its first
 * response (old forms and brand-new forms alike, no per-form setup). A form can
 * be individually paused (a disabled `form_integrations` row).
 *
 * Called AFTER the submission commits; it must never throw into the submit path
 * — a Sheets outage can't block a respondent.
 */
export async function syncSubmissionToSheets(
  form: { id: string; workspaceId: string; title: string },
  answers: { fieldId: string; value: AnswerValue }[],
  submittedAt: Date,
): Promise<void> {
  try {
    // Global on? The workspace must have a Google connection.
    const [conn] = await db
      .select()
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, form.workspaceId),
          eq(workspaceConnections.provider, "google"),
        ),
      )
      .limit(1)
    if (!conn) return

    // This form's integration row, if any.
    const [row] = await db
      .select()
      .from(formIntegrations)
      .where(
        and(eq(formIntegrations.formId, form.id), eq(formIntegrations.type, "google_sheets")),
      )
      .limit(1)

    if (row && !row.enabled) return // explicitly paused for this form

    let config = row?.config as GoogleSheetsIntegrationConfig | undefined

    // No row yet → first response since the workspace connected. Provision the
    // form's spreadsheet now and remember it.
    if (!config) {
      config = await createFormSheet(conn, form.id, form.title)
      await db.insert(formIntegrations).values({
        formId: form.id,
        workspaceId: form.workspaceId,
        type: "google_sheets",
        enabled: true,
        config,
      })
    }

    const accessToken = await getValidAccessToken(conn)
    const answerByField = new Map(answers.map((a) => [a.fieldId, a.value]))
    const columns = config.columns ?? []
    const values = [
      submittedAt.toISOString(),
      ...columns.map((c) => cell(answerByField.get(c.fieldId))),
    ]
    await appendRow(accessToken, config.spreadsheetId, config.sheetName ?? DEFAULT_SHEET_NAME, values)
  } catch (err) {
    console.error("[sync] google sheets delivery failed", err)
  }
}
