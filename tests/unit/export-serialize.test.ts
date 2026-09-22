import { describe, expect, test } from "vitest"
import { buildColumns } from "@/lib/submissions/export-columns"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import type { ExportSubmission } from "@/lib/submissions/export-row"
import { csvChunks, exportFileName, jsonChunks } from "@/lib/submissions/export-serialize"

const sources = {
  fields: [{ id: "f1", label: "Name", type: "short_text" }],
  removedQuestions: [],
  followUpCount: 0,
  timezone: "UTC",
}

function subject(values: Record<string, unknown>): ExportSubmission {
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
  const spec = exportSpecSchema.parse({})
  return {
    form: { id: "form1", title: "Job Application" },
    columns: buildColumns(spec, sources),
    sources,
    rows: (async function* () {
      for (const r of rows) yield r
    })(),
  }
}

const drain = async (gen: AsyncGenerator<string>) => {
  let out = ""
  for await (const chunk of gen) out += chunk
  return out
}

describe("csvChunks", () => {
  test("a BOM, a header and one line per row", async () => {
    const csv = await drain(csvChunks(source([subject({ f1: "Ayesha" })])))
    expect(csv.startsWith("﻿")).toBe(true)
    // `trim()` eats the BOM (U+FEFF counts as whitespace), which is why it is
    // asserted separately above rather than expected on the first line here.
    expect(csv.trim().split("\n")).toEqual([
      `"Submitted (UTC)","Name"`,
      `"2026-09-22 08:45:00","Ayesha"`,
    ])
  })

  test("respondent text cannot become a live formula", async () => {
    const csv = await drain(csvChunks(source([subject({ f1: `=HYPERLINK("http://evil.test","x")` })])))
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`)
    expect(csv).not.toMatch(/,"=/)
  })

  test("a header still comes out when there are no rows", async () => {
    const csv = await drain(csvChunks(source([])))
    expect(csv.trim().split("\n")).toHaveLength(1)
  })
})

describe("jsonChunks", () => {
  test("valid JSON with the form, the spec and the rows", async () => {
    const spec = exportSpecSchema.parse({})
    const text = await drain(
      jsonChunks(source([subject({ f1: "Ayesha" })]), {
        spec,
        exportedAt: new Date("2026-09-22T09:00:00.000Z"),
      }),
    )
    expect(JSON.parse(text)).toEqual({
      form: { id: "form1", title: "Job Application" },
      exportedAt: "2026-09-22T09:00:00.000Z",
      timezone: "UTC",
      rowCount: 1,
      rows: [{ "Submitted (UTC)": "2026-09-22 08:45:00", Name: "Ayesha" }],
    })
  })

  test("an empty export is still parseable", async () => {
    const spec = exportSpecSchema.parse({})
    const text = await drain(jsonChunks(source([]), { spec, exportedAt: new Date() }))
    expect(JSON.parse(text).rows).toEqual([])
  })
})

describe("exportFileName", () => {
  test("slug, date and extension", () => {
    expect(exportFileName("Job Application", "csv", new Date("2026-09-22T00:00:00.000Z"))).toBe(
      "job-application-2026-09-22.csv",
    )
    expect(exportFileName("", "xlsx", new Date("2026-09-22T00:00:00.000Z"))).toBe("form-2026-09-22.xlsx")
    expect(exportFileName("استمارة", "json", new Date("2026-09-22T00:00:00.000Z"))).toBe("form-2026-09-22.json")
  })
})
