import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { markdownToPlainText } from "@/lib/markdown"
import { db } from "@/lib/db"
import {
  formFields,
  type GoogleSheetsIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  createSpreadsheet,
  getSheetId,
  getValidAccessToken,
  readGridRows,
  runBatchUpdate,
  tagColumnRequest,
  tagRowRequest,
  writeCellRequest,
  DEFAULT_SHEET_NAME,
} from "@/lib/integrations/google"
import {
  HEADER_TAG,
  ID_TAG,
  TAG_KEYS,
  TIMESTAMP_TAG,
  fieldTag,
  planRepair,
  resolveLayout,
  type SheetLayout,
} from "@/lib/integrations/sheet-layout"
import { searchDeveloperMetadata } from "@/lib/integrations/google"

/**
 * Shared Google-Sheets provisioning, reused by the enable action AND the lazy
 * sync that runs on first submission. Keeping it in one place means the sheet
 * layout can never drift between the two paths.
 *
 * Layout on a fresh sheet: `[Submission ID, Submitted at, ...question columns]`.
 * Where those columns sit AFTERWARDS is not our decision — the owner may hide,
 * drag or insert around them freely. Each one carries a developer metadata tag
 * that Sheets moves along with it, and {@link reconcileFormSheet} reads the tags
 * back to find out where everything actually is. See sheet-layout.ts.
 */

/**
 * Does this stored config point at a spreadsheet in a Google account the
 * workspace is no longer connected to?
 *
 * A spreadsheet lives in the Drive of whichever account was connected when it
 * was created, and `config.connectionId` records which grant that was. Swap the
 * workspace's Google account — disconnect, then connect a different one — and
 * every config written before the swap names a file the new token cannot touch:
 * Sheets answers 403 or 404, and no retry fixes that. The connection id is the
 * only signal there is; nothing else about the config changes.
 *
 * Conservative on purpose: a config from before connection ids were recorded has
 * none, and counts as current rather than being silently re-provisioned.
 */
export function isOrphanedSheetConfig(
  config: Partial<Pick<GoogleSheetsIntegrationConfig, "connectionId">> | undefined | null,
  connectionId: string,
): boolean {
  if (!config?.connectionId) return false
  return config.connectionId !== connectionId
}

/** Field types that don't collect an answer — excluded from the sheet columns. */
const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])

/** The leading columns every export carries, before the question columns. */
export const ID_HEADER = "Submission ID"
export const TIMESTAMP_HEADER = "Submitted at"

/** How far down to look for a header when migrating an untagged sheet. */
const HEADER_SEARCH_ROWS = 20

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
    // Sheet header cells want the words, not the markdown the question is
    // authored in.
    .map((f, i) => ({ fieldId: f.id, label: markdownToPlainText(f.label) || `Question ${i + 1}` }))
}

/**
 * Append-only merge: keep existing columns in their frozen order (refreshing
 * each label from the live field, e.g. a renamed question), then add any field
 * that isn't a column yet to the END.
 *
 * This is now only the record of which questions the sheet KNOWS ABOUT, and in
 * what order a fresh sheet would lay them out. Physical position comes from the
 * tags, not from here.
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

/** Create a fresh spreadsheet for a form, write its header and tag every column. */
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

  const config: GoogleSheetsIntegrationConfig = {
    connectionId: conn.id,
    spreadsheetId,
    spreadsheetUrl,
    sheetName: DEFAULT_SHEET_NAME,
    sheetId: sheetId ?? undefined,
    hasIdColumn: true,
    columns,
  }

  // A brand-new spreadsheet always reports its sheet id; if Google ever does
  // not, the sheet is left untagged and the next reconcile migrates it rather
  // than the provisioning failing outright.
  if (sheetId == null) {
    console.warn(`[sheets] no sheetId for new spreadsheet ${spreadsheetId}; leaving it untagged`)
    return config
  }

  const headers = [ID_HEADER, TIMESTAMP_HEADER, ...columns.map((c) => c.label)]
  // One atomic batchUpdate: a sheet that is half-tagged is worse than one that
  // is not tagged at all, because resolveLayout would believe the half.
  await runBatchUpdate(accessToken, spreadsheetId, [
    ...headers.map((label, i) => writeCellRequest(sheetId, 0, i, label)),
    tagRowRequest(sheetId, 0, HEADER_TAG),
    tagColumnRequest(sheetId, 0, ID_TAG),
    tagColumnRequest(sheetId, 1, TIMESTAMP_TAG),
    ...columns.map((c, i) => tagColumnRequest(sheetId, 2 + i, fieldTag(c.fieldId))),
  ])

  return config
}

/**
 * Where the header is on a sheet that predates tagging.
 *
 * The owner may well have inserted rows above it — that is exactly the edit
 * that broke appends in the first place — so row 1 is a guess, not a given.
 * Falls back to row 0 when nothing recognisable is found, which is right for a
 * sheet that is simply empty.
 */
function findHeaderRow(rows: string[][]): number {
  const looksLikeHeader = (row: string[] | undefined, label: string) =>
    (row ?? []).some((cell) => cell === label)
  const byId = rows.findIndex((r) => looksLikeHeader(r, ID_HEADER))
  if (byId >= 0) return byId
  const byTimestamp = rows.findIndex((r) => looksLikeHeader(r, TIMESTAMP_HEADER))
  if (byTimestamp >= 0) return byTimestamp
  return 0
}

/**
 * Tag a sheet that has none, in place.
 *
 * Nothing is inserted, deleted or shifted: every column keeps the cells it
 * already holds, and we simply record where each one is. Columns are found by
 * matching the header text against the labels the config already knows, which
 * is the only correspondence a pre-tagging sheet carries. A stored column whose
 * header cannot be found is left for {@link planRepair} to re-create at the end.
 */
async function migrateUntaggedSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  columns: Column[],
): Promise<SheetLayout> {
  const rows = await readGridRows(accessToken, spreadsheetId, sheetId, HEADER_SEARCH_ROWS)
  const headerRow = findHeaderRow(rows)
  const header = rows[headerRow] ?? []

  const taken = new Set<number>()
  /** First column whose header cell reads `label` and is not already claimed. */
  const locate = (label: string): number | null => {
    const at = header.findIndex((cell, i) => cell === label && !taken.has(i))
    if (at < 0) return null
    taken.add(at)
    return at
  }

  // The id and timestamp columns are the two we cannot do without. If the sheet
  // never had them (or the owner renamed them), fall back to the canonical
  // leading positions — which is where every sheet we ever made put them.
  const idColumn = locate(ID_HEADER) ?? 0
  taken.add(idColumn)
  const timestampColumn = locate(TIMESTAMP_HEADER) ?? (idColumn === 0 ? 1 : 0)
  taken.add(timestampColumn)

  const fieldColumns = new Map<string, number>()
  const requests: unknown[] = [
    tagRowRequest(sheetId, headerRow, HEADER_TAG),
    tagColumnRequest(sheetId, idColumn, ID_TAG),
    tagColumnRequest(sheetId, timestampColumn, TIMESTAMP_TAG),
  ]
  for (const column of columns) {
    const at = locate(column.label)
    if (at === null) continue
    fieldColumns.set(column.fieldId, at)
    requests.push(tagColumnRequest(sheetId, at, fieldTag(column.fieldId)))
  }

  await runBatchUpdate(accessToken, spreadsheetId, requests)
  console.warn(
    `[sheets] migrated untagged spreadsheet ${spreadsheetId} in place: header row ${headerRow}, ${fieldColumns.size} of ${columns.length} columns matched`,
  )

  return {
    sheetId,
    headerRow,
    idColumn,
    timestampColumn,
    fieldColumns,
    lastColumn: Math.max(idColumn, timestampColumn, ...fieldColumns.values()),
  }
}

/**
 * Find out where this sheet's columns actually are, and bring it in line with
 * the form: a column for any question added since the last sync, and header
 * text for any question since renamed.
 *
 * Returns the updated config, whether anything changed (so the caller can skip
 * a pointless DB write), and the resolved layout for the caller to write
 * through. `layout` is null only when the sheet cannot be addressed at all —
 * no resolvable sheet id — in which case the caller falls back to the old
 * positional path rather than dropping the response.
 */
export async function reconcileFormSheet(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<{ config: GoogleSheetsIntegrationConfig; changed: boolean; layout: SheetLayout | null }> {
  const accessToken = await getValidAccessToken(conn)
  const sheetName = config.sheetName ?? DEFAULT_SHEET_NAME

  // Prefer the STORED id. Looking the tab up by name is what broke when the
  // owner renamed it, so the name is only a fallback for configs old enough to
  // predate the id being recorded.
  let sheetId = config.sheetId ?? null
  if (sheetId == null) sheetId = await getSheetId(accessToken, config.spreadsheetId, sheetName)

  const existing = config.columns ?? []
  const merged = mergeColumns(existing, await answerableColumns(formId))

  const colsChanged =
    merged.length !== existing.length ||
    merged.some((c, i) => existing[i]?.fieldId !== c.fieldId || existing[i]?.label !== c.label)
  const sheetIdChanged = (sheetId ?? null) !== (config.sheetId ?? null)

  if (sheetId == null) {
    // Nothing addressable. Leave the config alone and let the caller decide.
    return {
      config: { ...config, columns: merged },
      changed: colsChanged,
      layout: null,
    }
  }

  const tags = await searchDeveloperMetadata(accessToken, config.spreadsheetId, TAG_KEYS)
  let layout = resolveLayout(tags, sheetId)
  if (!layout) layout = await migrateUntaggedSheet(accessToken, config.spreadsheetId, sheetId, merged)

  const rows = await readGridRows(accessToken, config.spreadsheetId, sheetId, layout.headerRow + 1)
  const headerCells = rows[layout.headerRow] ?? []
  const plan = planRepair(layout, merged, headerCells)

  if (plan.create.length || plan.relabel.length) {
    await runBatchUpdate(accessToken, config.spreadsheetId, [
      ...plan.relabel.map((r) => writeCellRequest(sheetId, layout.headerRow, r.index, r.label)),
      ...plan.create.flatMap((c) => [
        writeCellRequest(sheetId, layout.headerRow, c.index, c.label),
        tagColumnRequest(sheetId, c.index, fieldTag(c.fieldId)),
      ]),
    ])
    // Fold the new columns in rather than re-searching: we just created them,
    // and a second round-trip would only tell us what we already know.
    for (const c of plan.create) layout.fieldColumns.set(c.fieldId, c.index)
    if (plan.create.length) {
      layout.lastColumn = Math.max(layout.lastColumn, ...plan.create.map((c) => c.index))
    }
  }

  return {
    config: { ...config, sheetId, hasIdColumn: true, columns: merged },
    changed: colsChanged || sheetIdChanged || !config.hasIdColumn,
    layout,
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
