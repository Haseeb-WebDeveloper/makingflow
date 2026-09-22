import { describe, expect, test } from "vitest"
import { buildColumns, type ColumnSources } from "@/lib/submissions/export-columns"
import { DEFAULT_SPEC, exportSpecSchema } from "@/lib/submissions/export-spec"

const sources: ColumnSources = {
  fields: [
    { id: "f1", label: "**Full name**", type: "short_text" },
    { id: "f2", label: "", type: "long_text" },
    { id: "f3", label: "Upload your CV", type: "file_upload" },
  ],
  removedQuestions: ["Why did you leave?"],
  followUpCount: 2,
  timezone: "Asia/Karachi",
}

const headers = (spec = DEFAULT_SPEC) => buildColumns(spec, sources).map((c) => c.header)

describe("buildColumns", () => {
  test("the default is a Submitted column plus every question, markdown stripped", () => {
    expect(headers()).toEqual([
      "Submitted (Asia/Karachi)",
      "Full name",
      "Untitled",
      "Upload your CV",
    ])
  })

  test("meta columns come in the order the spec lists them, before the questions", () => {
    const spec = exportSpecSchema.parse({
      columns: { meta: ["submissionId", "started", "submitted", "aiScore"] },
    })
    expect(headers(spec).slice(0, 4)).toEqual([
      "Submission ID",
      "Started (Asia/Karachi)",
      "Submitted (Asia/Karachi)",
      "AI score",
    ])
  })

  test("named fields are exported in form order, not in the order they were named", () => {
    const spec = exportSpecSchema.parse({ columns: { fields: ["f3", "f1"] } })
    expect(headers(spec)).toEqual(["Submitted (Asia/Karachi)", "Full name", "Upload your CV"])
  })

  test("removed questions are opt-in and marked", () => {
    const spec = exportSpecSchema.parse({ columns: { removedQuestions: true } })
    expect(headers(spec)).toContain("Why did you leave? (removed)")
    expect(headers()).not.toContain("Why did you leave? (removed)")
  })

  test("AI follow-ups become numbered question/answer pairs, stable across rows", () => {
    const spec = exportSpecSchema.parse({ columns: { aiFollowUps: true } })
    expect(headers(spec).slice(-4)).toEqual([
      "AI follow-up 1 — question",
      "AI follow-up 1 — answer",
      "AI follow-up 2 — question",
      "AI follow-up 2 — answer",
    ])
  })

  test("a form with no AI follow-ups gets no follow-up columns even when asked", () => {
    const spec = exportSpecSchema.parse({ columns: { aiFollowUps: true } })
    const cols = buildColumns(spec, { ...sources, followUpCount: 0 })
    expect(cols.some((c) => c.kind === "followUp")).toBe(false)
  })

  test("duplicate question labels are disambiguated so two columns are never identical", () => {
    const cols = buildColumns(DEFAULT_SPEC, {
      ...sources,
      fields: [
        { id: "a", label: "Email", type: "email" },
        { id: "b", label: "Email", type: "short_text" },
      ],
      removedQuestions: [],
      followUpCount: 0,
    })
    expect(cols.map((c) => c.header)).toEqual(["Submitted (Asia/Karachi)", "Email", "Email (2)"])
  })
})
