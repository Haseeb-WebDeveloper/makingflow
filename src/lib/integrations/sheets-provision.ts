import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formFields,
  type GoogleSheetsIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  createSpreadsheet,
  setHeaderRow,
  getValidAccessToken,
  DEFAULT_SHEET_NAME,
} from "@/lib/integrations/google"

/**
 * Shared Google-Sheets provisioning, reused by the enable action AND the lazy
 * sync that runs on first submission. Keeping it in one place means the header
 * layout (timestamp column + question columns) can never drift between the two
 * paths.
 */

/** Field types that don't collect an answer — excluded from the sheet columns. */
const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])

/** The leading column every export carries, before the question columns. */
export const TIMESTAMP_HEADER = "Submitted at"

/** Answerable fields of a form, in display order, as sheet columns. */
export async function answerableColumns(
  formId: string,
): Promise<{ fieldId: string; label: string }[]> {
  const fields = await db
    .select({ id: formFields.id, label: formFields.label, type: formFields.type })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  return fields
    .filter((f) => !NON_ANSWER.has(f.type))
    .map((f, i) => ({ fieldId: f.id, label: f.label || `Question ${i + 1}` }))
}

function headerRow(columns: { label: string }[]): string[] {
  return [TIMESTAMP_HEADER, ...columns.map((c) => c.label)]
}

/** Create a fresh spreadsheet for a form and write its header. */
export async function createFormSheet(
  conn: WorkspaceConnection,
  formId: string,
  formTitle: string,
): Promise<GoogleSheetsIntegrationConfig> {
  const columns = await answerableColumns(formId)
  const accessToken = await getValidAccessToken(conn)
  const { spreadsheetId, spreadsheetUrl } = await createSpreadsheet(
    accessToken,
    `MakingFlow – ${formTitle || "Untitled form"}`,
    DEFAULT_SHEET_NAME,
  )
  await setHeaderRow(accessToken, spreadsheetId, DEFAULT_SHEET_NAME, headerRow(columns))
  return {
    connectionId: conn.id,
    spreadsheetId,
    spreadsheetUrl,
    sheetName: DEFAULT_SHEET_NAME,
    columns,
  }
}

/** Re-write an existing sheet's header to match the form's current questions. */
export async function refreshFormSheetHeader(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<GoogleSheetsIntegrationConfig> {
  const columns = await answerableColumns(formId)
  const accessToken = await getValidAccessToken(conn)
  await setHeaderRow(
    accessToken,
    config.spreadsheetId,
    config.sheetName ?? DEFAULT_SHEET_NAME,
    headerRow(columns),
  )
  return { ...config, columns }
}
