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
  getSheetId,
  insertColumns,
  getValidAccessToken,
  DEFAULT_SHEET_NAME,
} from "@/lib/integrations/google"

/**
 * Shared Google-Sheets provisioning, reused by the enable action AND the lazy
 * sync that runs on first submission. Keeping it in one place means the sheet
 * layout can never drift between the two paths.
 *
 * Layout: `[Submission ID, Submitted at, ...question columns]`. The leading id
 * column is how we find a submission's row later to delete it. Question columns
 * are append-only — a new field adds a column at the end (old rows stay aligned,
 * blank there); a removed field keeps its column so old rows still resolve.
 */

/** Field types that don't collect an answer — excluded from the sheet columns. */
const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])

/** The leading columns every export carries, before the question columns. */
export const ID_HEADER = "Submission ID"
export const TIMESTAMP_HEADER = "Submitted at"

type Column = { fieldId: string; label: string }

/** Answerable fields of a form, in display order, as sheet columns. */
export async function answerableColumns(formId: string): Promise<Column[]> {
  const fields = await db
    .select({ id: formFields.id, label: formFields.label, type: formFields.type })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  return fields
    .filter((f) => !NON_ANSWER.has(f.type))
    .map((f, i) => ({ fieldId: f.id, label: f.label || `Question ${i + 1}` }))
}

function headerRow(columns: Column[], withId: boolean): string[] {
  const base = [TIMESTAMP_HEADER, ...columns.map((c) => c.label)]
  return withId ? [ID_HEADER, ...base] : base
}

/**
 * Append-only merge: keep existing columns in their frozen order (refreshing
 * each label from the live field, e.g. a renamed question), then add any field
 * that isn't a column yet to the END. Columns are never removed or reordered, so
 * existing rows in the sheet always stay aligned.
 */
function mergeColumns(existing: Column[], current: Column[]): Column[] {
  const liveLabel = new Map(current.map((c) => [c.fieldId, c.label]))
  const merged: Column[] = existing.map((c) => ({
    fieldId: c.fieldId,
    label: liveLabel.get(c.fieldId) ?? c.label,
  }))
  const seen = new Set(existing.map((c) => c.fieldId))
  for (const c of current) if (!seen.has(c.fieldId)) merged.push(c)
  return merged
}

/** Create a fresh spreadsheet for a form and write its header. */
export async function createFormSheet(
  conn: WorkspaceConnection,
  formId: string,
  formTitle: string,
): Promise<GoogleSheetsIntegrationConfig> {
  const columns = await answerableColumns(formId)
  const accessToken = await getValidAccessToken(conn)
  const { spreadsheetId, spreadsheetUrl, sheetId } = await createSpreadsheet(
    accessToken,
    `MakingFlow – ${formTitle || "Untitled form"}`,
    DEFAULT_SHEET_NAME,
  )
  await setHeaderRow(accessToken, spreadsheetId, DEFAULT_SHEET_NAME, headerRow(columns, true))
  return {
    connectionId: conn.id,
    spreadsheetId,
    spreadsheetUrl,
    sheetName: DEFAULT_SHEET_NAME,
    sheetId: sheetId ?? undefined,
    hasIdColumn: true,
    columns,
  }
}

/**
 * Bring an existing sheet in line with the form: ensure it knows its inner
 * `sheetId`, ensure the leading Submission ID column exists (inserting it for
 * pre-feature sheets), and grow the question columns to cover any newly added
 * fields. Returns the updated config plus whether anything changed (so the
 * caller can skip a pointless DB write when nothing did).
 */
export async function reconcileFormSheet(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<{ config: GoogleSheetsIntegrationConfig; changed: boolean }> {
  const accessToken = await getValidAccessToken(conn)
  const sheetName = config.sheetName ?? DEFAULT_SHEET_NAME

  let sheetId = config.sheetId ?? null
  if (sheetId == null) sheetId = await getSheetId(accessToken, config.spreadsheetId, sheetName)

  const existing = config.columns ?? []
  const merged = mergeColumns(existing, await answerableColumns(formId))

  // Migrate a pre-feature sheet to the id-column layout: insert a leading column
  // so existing data shifts right to make room (those rows get a blank id and so
  // aren't individually deletable — they predate row tracking, as expected). We
  // need the sheetId to shift data; without it we leave the layout untouched.
  let hasIdColumn = config.hasIdColumn ?? false
  if (!hasIdColumn && sheetId != null) {
    await insertColumns(accessToken, config.spreadsheetId, sheetId, 0, 1)
    hasIdColumn = true
  }

  const colsChanged =
    merged.length !== existing.length ||
    merged.some((c, i) => existing[i]?.fieldId !== c.fieldId || existing[i]?.label !== c.label)
  const idChanged = hasIdColumn !== (config.hasIdColumn ?? false)
  const sheetIdChanged = (sheetId ?? null) !== (config.sheetId ?? null)

  if (colsChanged || idChanged) {
    await setHeaderRow(accessToken, config.spreadsheetId, sheetName, headerRow(merged, hasIdColumn))
  }

  return {
    config: { ...config, sheetId: sheetId ?? undefined, hasIdColumn, columns: merged },
    changed: colsChanged || idChanged || sheetIdChanged,
  }
}

/** Re-sync an existing sheet's header/columns to the form (used by the enable
 *  action). Thin wrapper over {@link reconcileFormSheet}. */
export async function refreshFormSheetHeader(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<GoogleSheetsIntegrationConfig> {
  const { config: next } = await reconcileFormSheet(conn, config, formId)
  return next
}
