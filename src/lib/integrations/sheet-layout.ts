import "server-only"

/**
 * Where MakingFlow's columns actually are, right now.
 *
 * The sync used to assume the header was row 1 and the Submission ID column A,
 * then write `[id, submittedAt, ...answers]` into A, B, C… Every one of those
 * assumptions is something the sheet's owner can change with two clicks, and
 * when they did, rows silently landed in the wrong columns — or above the
 * header, where the dedup and deletion lookups could no longer see them.
 *
 * So we stop assuming. Each column we own carries a Google Developer Metadata
 * tag, and Sheets moves that tag with the column through inserts, deletes and
 * reorders. This module turns a bag of tags back into "the id is column H, the
 * header is row 5" — pure, so every rule here is testable without a network.
 */

export const TAG_COLUMN = "makingflow.col"
export const TAG_ROW = "makingflow.row"
export const TAG_KEYS = [TAG_COLUMN, TAG_ROW] as const

export const ID_TAG = "id"
export const TIMESTAMP_TAG = "ts"
export const HEADER_TAG = "header"

const FIELD_PREFIX = "f:"

export function fieldTag(fieldId: string): string {
  return `${FIELD_PREFIX}${fieldId}`
}

export function parseFieldTag(value: string): string | null {
  return value.startsWith(FIELD_PREFIX) ? value.slice(FIELD_PREFIX.length) : null
}

export type MetadataTag = {
  key: string
  value: string
  dimension: "ROWS" | "COLUMNS"
  /** 0-based, inclusive. */
  index: number
  sheetId: number
}

export type SheetLayout = {
  sheetId: number
  headerRow: number
  idColumn: number
  timestampColumn: number
  /** fieldId -> 0-based column index. */
  fieldColumns: Map<string, number>
  /** Highest column index we own — appended rows are trimmed here. */
  lastColumn: number
}

/**
 * Leftmost wins. Two deliveries can repair the same sheet concurrently and each
 * create a column for the same field; picking deterministically means both
 * workers agree on where the answer goes, and the stray column is cleaned up on
 * the next reconcile rather than splitting the data.
 */
function claim(into: Map<string, number>, key: string, index: number): void {
  const held = into.get(key)
  if (held === undefined || index < held) into.set(key, index)
}

export function resolveLayout(tags: MetadataTag[], sheetId: number): SheetLayout | null {
  const columns = new Map<string, number>()
  let headerRow: number | null = null

  for (const tag of tags) {
    if (tag.sheetId !== sheetId) continue
    if (tag.key === TAG_ROW && tag.value === HEADER_TAG && tag.dimension === "ROWS") {
      if (headerRow === null || tag.index < headerRow) headerRow = tag.index
      continue
    }
    if (tag.key === TAG_COLUMN && tag.dimension === "COLUMNS") claim(columns, tag.value, tag.index)
  }

  const idColumn = columns.get(ID_TAG)
  const timestampColumn = columns.get(TIMESTAMP_TAG)
  // Without any one of these there is no safe write: no header means we cannot
  // tell data from labels, and no id column means no dedup and no deletion.
  if (headerRow === null || idColumn === undefined || timestampColumn === undefined) return null

  const fieldColumns = new Map<string, number>()
  for (const [value, index] of columns) {
    const fieldId = parseFieldTag(value)
    if (fieldId) fieldColumns.set(fieldId, index)
  }

  const lastColumn = Math.max(idColumn, timestampColumn, ...fieldColumns.values())

  return { sheetId, headerRow, idColumn, timestampColumn, fieldColumns, lastColumn }
}

/** A cell to write, or `null` to leave whatever is there alone. */
export type Cell = string | null

/**
 * One row, laid out by resolved column index rather than field order.
 *
 * Trimmed at `lastColumn` on purpose: anything further right belongs to the
 * sheet's owner, and an appended blank there would overwrite a spilled
 * ARRAYFORMULA with an empty value.
 */
export function buildRow(
  layout: SheetLayout,
  values: { submissionId: string; submittedAt: string; byField: Map<string, string> },
): Cell[] {
  const cells: Cell[] = new Array(layout.lastColumn + 1).fill(null)
  cells[layout.idColumn] = values.submissionId
  cells[layout.timestampColumn] = values.submittedAt
  for (const [fieldId, index] of layout.fieldColumns) {
    cells[index] = values.byField.get(fieldId) ?? ""
  }
  return cells
}

export type RepairPlan = {
  create: { fieldId: string; label: string; index: number }[]
  relabel: { index: number; label: string }[]
}

/**
 * What this sheet needs to match the form: columns for questions added since
 * the last sync, and header text for questions since renamed (or blanked by
 * hand). A question removed from the form keeps its column — historic rows
 * still resolve through it.
 *
 * New columns start past the last USED column, not merely past the last one we
 * own. Those are different numbers the moment the owner adds a column of their
 * own on the right, and taking the first free index we knew about would drop a
 * question's answers straight onto their data.
 */
export function planRepair(
  layout: SheetLayout,
  desired: { fieldId: string; label: string }[],
  headerCells: string[],
): RepairPlan {
  const create: RepairPlan["create"] = []
  const relabel: RepairPlan["relabel"] = []
  let next = Math.max(layout.lastColumn + 1, headerCells.length)

  for (const field of desired) {
    const index = layout.fieldColumns.get(field.fieldId)
    if (index === undefined) {
      create.push({ fieldId: field.fieldId, label: field.label, index: next })
      next += 1
      continue
    }
    if ((headerCells[index] ?? "") !== field.label) relabel.push({ index, label: field.label })
  }

  return { create, relabel }
}
