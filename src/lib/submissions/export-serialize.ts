/**
 * Turning a row stream into bytes.
 *
 * Generators rather than strings, because an export is unbounded and the whole
 * point of the streaming route is that no single buffer ever holds all of it.
 * Rows are batched before being yielded: one `enqueue` per row on a 20,000-row
 * export is 20,000 syscalls for no benefit.
 *
 * Escaping lives HERE and nowhere else. `escapeCsvCell` both quotes and
 * neutralises a leading `=`, `+`, `-` or `@`, which is what keeps a
 * respondent's answer from executing in the owner's spreadsheet.
 */

import { csvRow } from "@/lib/submissions/csv"
import type { ExportSource } from "@/lib/submissions/export-query"
import { rowCells, rowObject } from "@/lib/submissions/export-row"
import type { ExportFormat, ExportSpec } from "@/lib/submissions/export-spec"

/** Rows accumulated before a chunk is handed to the stream. */
const BATCH = 200

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

export async function* csvChunks(source: ExportSource): AsyncGenerator<string> {
  // BOM so Excel on Windows reads UTF-8 rather than the local code page.
  yield `﻿${csvRow(source.columns.map((c) => c.header))}\n`

  let batch = ""
  let n = 0
  for await (const sub of source.rows) {
    batch += `${csvRow(rowCells(sub, source.columns))}\n`
    if ((n += 1) % BATCH === 0) {
      yield batch
      batch = ""
    }
  }
  if (batch) yield batch
}

export async function* jsonChunks(
  source: ExportSource,
  meta: { spec: ExportSpec; exportedAt: Date },
): AsyncGenerator<string> {
  // Hand-assembled rather than JSON.stringify'd whole, so the rows never all
  // exist at once. `rowCount` comes last for the same reason — it is not known
  // until the stream is done.
  yield `{"form":${JSON.stringify(source.form)},"exportedAt":${JSON.stringify(
    meta.exportedAt.toISOString(),
  )},"timezone":${JSON.stringify(source.sources.timezone)},"rows":[`

  let n = 0
  for await (const sub of source.rows) {
    yield `${n === 0 ? "" : ","}${JSON.stringify(rowObject(sub, source.columns))}`
    n += 1
  }
  yield `],"rowCount":${n}}`
}

/**
 * `job-application-2026-09-22.csv`.
 *
 * The date is in the name because the previous version was not, and two exports
 * a week apart both landed as `job-application-submissions.csv` — the second
 * silently replacing the first in the owner's Downloads folder. A title with no
 * ASCII word characters (Arabic, Chinese) slugs to nothing and falls back to
 * `form`, which is ugly but never an invalid filename.
 */
export function exportFileName(formTitle: string, format: ExportFormat, now: Date): string {
  const slug = formTitle
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
  const day = now.toISOString().slice(0, 10)
  return `${slug || "form"}-${day}.${format}`
}
