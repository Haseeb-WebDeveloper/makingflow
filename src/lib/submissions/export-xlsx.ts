import "server-only"

/**
 * The format most owners actually want.
 *
 * A CSV opens in Excel but is a text file pretending to be a spreadsheet: it
 * relies on a byte-order mark to avoid mojibake, has no column widths, no
 * frozen header, and leaves Excel guessing at every value on open. This is a
 * real workbook. Written with exceljs rather than by hand because an xlsx is a
 * zip of XML parts, and hand-rolling one is a week of other people's bug
 * reports.
 *
 * EVERY CELL IS A STRING, deliberately. Handed `=SUM(A1)` as a value, exceljs
 * will write a live formula — the same injection the CSV path defuses with a
 * leading apostrophe. Here the fix is to declare the type instead, which is
 * strictly better: the apostrophe is a visible character in a spreadsheet cell,
 * and this way the owner sees exactly what the respondent typed. Numbers as
 * text is the accepted cost; a column converts in one click, whereas nobody can
 * recover an answer that Excel evaluated.
 *
 * IT CANNOT STREAM, unlike CSV and JSON: a workbook is only valid once
 * finalised, so the whole thing is assembled in memory before a byte goes out.
 * That is why there is a row ceiling, and why it is enforced by refusing rather
 * than by truncating.
 */

import ExcelJS from "exceljs"
import type { ExportSource } from "@/lib/submissions/export-query"
import { rowCells } from "@/lib/submissions/export-row"

/**
 * Rows we will build a workbook for in one request.
 *
 * The same number as the streaming ceiling, and it must never be HIGHER: this
 * path does strictly more work than a CSV — the identical database scan, plus
 * assembling a whole workbook in memory, with no streaming to spread it over
 * the response. Excel's own limit is 1,048,576 and is nowhere near the
 * constraint; a 60-second request is. Above it the answer is CSV.
 */
export const XLSX_ROW_CEILING = 5000

export async function writeXlsx(
  source: ExportSource,
  ceiling: number = XLSX_ROW_CEILING,
): Promise<{ bytes: Uint8Array; rowCount: number }> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "MakingFlow"
  workbook.created = new Date(0) // deterministic: the filename carries the date
  const sheet = workbook.addWorksheet("Responses", {
    views: [{ state: "frozen", ySplit: 1 }],
  })

  const header = sheet.addRow(source.columns.map((c) => c.header))
  header.font = { bold: true }

  let rowCount = 0
  for await (const sub of source.rows) {
    if (rowCount >= ceiling) {
      // Refuse, never trim. A short spreadsheet that looks complete is the
      // failure this whole piece of work exists to remove.
      throw new Error(
        `This export is too large for a spreadsheet (${ceiling.toLocaleString()} rows). Export as CSV instead.`,
      )
    }
    const row = sheet.addRow(rowCells(sub, source.columns))
    // Belt and braces: rowCells already returns strings, but a value that
    // starts with `=` is only inert once the cell's type says so.
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = cell.value == null ? "" : String(cell.value)
    })
    rowCount += 1
  }

  for (const column of sheet.columns) {
    column.width = 24
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return { bytes: new Uint8Array(buffer as ArrayBuffer), rowCount }
}
