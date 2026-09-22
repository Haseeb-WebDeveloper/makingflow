import { describe, expect, test } from "vitest"
import ExcelJS from "exceljs"
import { buildColumns } from "@/lib/submissions/export-columns"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import type { ExportSubmission } from "@/lib/submissions/export-row"
import { writeXlsx, XLSX_ROW_CEILING } from "@/lib/submissions/export-xlsx"

const sources = {
  fields: [
    { id: "f1", label: "Name", type: "short_text" },
    { id: "f2", label: "Score", type: "rating" },
  ],
  removedQuestions: [],
  followUpCount: 0,
  timezone: "UTC",
}

function sub(values: Record<string, unknown>): ExportSubmission {
  return {
    id: "s1",
    createdAt: new Date("2026-09-22T08:45:00.000Z"),
    completedAt: new Date("2026-09-22T08:45:00.000Z"),
    status: "completed",
    language: null,
    mode: "classic",
    reviewStatus: "new",
    tags: [],
    aiSummary: null,
    aiScore: null,
    aiScreenReason: null,
    calculations: null,
    meta: null,
    values: values as never,
    removed: {},
    followUps: [],
    files: [],
  }
}

function source(rows: ExportSubmission[]) {
  const spec = exportSpecSchema.parse({ format: "xlsx" })
  return {
    form: { id: "f", title: "Applications" },
    columns: buildColumns(spec, sources),
    sources,
    rows: (async function* () {
      for (const r of rows) yield r
    })(),
  } as never
}

async function read(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as never)
  const sheet = wb.worksheets[0]
  const rows: unknown[][] = []
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
  return { wb, sheet, rows }
}

describe("writeXlsx", () => {
  test("a header row and one row per submission", async () => {
    const { bytes, rowCount } = await writeXlsx(source([sub({ f1: "Ayesha", f2: 5 })]))
    const { rows, sheet } = await read(bytes)
    expect(sheet.name).toBe("Responses")
    expect(rows[0]).toEqual(["Submitted (UTC)", "Name", "Score"])
    expect(rows[1]).toEqual(["2026-09-22 08:45:00", "Ayesha", "5"])
    expect(rowCount).toBe(1)
  })

  test("the header row is frozen and bold, so a long export stays readable", async () => {
    const { bytes } = await writeXlsx(source([sub({ f1: "Ayesha" })]))
    const { sheet } = await read(bytes)
    expect(sheet.getRow(1).font?.bold).toBe(true)
    expect(sheet.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 })
  })

  test("respondent text is inert: a leading = is stored as text, never as a formula", async () => {
    const { bytes } = await writeXlsx(source([sub({ f1: "=HYPERLINK(\"http://evil.test\",\"x\")" })]))
    const { sheet } = await read(bytes)
    const cell = sheet.getCell("B2")
    expect(cell.formula).toBeUndefined()
    expect(cell.value).toBe("=HYPERLINK(\"http://evil.test\",\"x\")")
    // And no apostrophe smuggled in: xlsx stores the text as text, so the CSV
    // escape would show up as a literal character in the cell.
    expect(String(cell.value).startsWith("'")).toBe(false)
  })

  test("an empty export still opens as a usable sheet with its headers", async () => {
    const { bytes, rowCount } = await writeXlsx(source([]))
    const { rows } = await read(bytes)
    expect(rowCount).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(["Submitted (UTC)", "Name", "Score"])
  })

  test("an export beyond the workbook ceiling is refused rather than trimmed", async () => {
    const many = Array.from({ length: 3 }, () => sub({ f1: "x" }))
    await expect(writeXlsx(source(many), 2)).rejects.toThrow(/too large for a spreadsheet/i)
    expect(XLSX_ROW_CEILING).toBeGreaterThanOrEqual(1000)
  })
})

test("the ceiling the dialog shows matches the one the writer enforces", async () => {
  // XLSX_SYNC_ROW_CEILING is duplicated in export-spec.ts because that module
  // is client-safe and this one is server-only. If they drift, somebody is told
  // one limit and hits another.
  const { XLSX_SYNC_ROW_CEILING, syncCeilingFor } = await import("@/lib/submissions/export-spec")
  expect(XLSX_SYNC_ROW_CEILING).toBe(XLSX_ROW_CEILING)
  expect(syncCeilingFor("xlsx")).toBe(XLSX_ROW_CEILING)
})
