import { describe, expect, test } from "vitest"
import { buildColumns } from "@/lib/submissions/export-columns"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import { formatDateTime, rowCells, rowObject, type ExportSubmission } from "@/lib/submissions/export-row"

const sub: ExportSubmission = {
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: new Date("2026-09-20T05:00:00.000Z"),
  completedAt: new Date("2026-09-22T08:45:00.000Z"),
  status: "completed",
  language: "ur",
  mode: "conversational",
  reviewStatus: "reviewing",
  tags: ["shortlist", "senior"],
  aiSummary: "Strong backend background.",
  aiScore: 82,
  aiScreenReason: "Matches every requirement.",
  calculations: { score: 17 },
  meta: { urlParams: { utm_source: "linkedin" }, referrer: "https://x.test", device: "mobile", country: "PK" },
  values: { f1: "Ayesha", f3: { files: [{ name: "cv.pdf", url: "https://res.test/cv.pdf" }] } as never },
  removed: { "Why did you leave?": "Relocated" },
  followUps: [{ question: "Which stack?", answer: "Postgres" }],
  files: [{ path: "makingflow/submissions/ab12cd.pdf", url: "https://res.test/cv.pdf", name: "cv.pdf" }],
}

const fields = [
  { id: "f1", label: "Full name", type: "short_text" },
  { id: "f3", label: "CV", type: "file_upload" },
]
const sources = { fields, removedQuestions: ["Why did you leave?"], followUpCount: 1, timezone: "Asia/Karachi" }

describe("export rows", () => {
  test("wall-clock formatting is ISO-shaped in the requested zone", () => {
    expect(formatDateTime(new Date("2026-09-22T08:45:00.000Z"), "Asia/Karachi")).toBe("2026-09-22 13:45:00")
    expect(formatDateTime(new Date("2026-09-22T08:45:00.000Z"), "UTC")).toBe("2026-09-22 08:45:00")
    expect(formatDateTime(null, "UTC")).toBe("")
  })

  test("Submitted is the completion time, Started is the creation time", () => {
    const spec = exportSpecSchema.parse({ columns: { meta: ["submitted", "started"], fields: [] } })
    expect(rowCells(sub, buildColumns(spec, sources))).toEqual(["2026-09-22 13:45:00", "2026-09-20 10:00:00"])
  })

  test("a submission with no completedAt falls back to createdAt so the column is never blank", () => {
    const spec = exportSpecSchema.parse({ columns: { meta: ["submitted"], fields: [] } })
    const legacy = { ...sub, completedAt: null }
    expect(rowCells(legacy, buildColumns(spec, sources))).toEqual(["2026-09-20 10:00:00"])
  })

  test("every meta column renders as flat text a spreadsheet can hold", () => {
    const spec = exportSpecSchema.parse({
      columns: {
        meta: ["submissionId", "isoSubmitted", "status", "language", "mode", "reviewStatus", "tags", "aiScore", "calculations", "utm", "referrer", "device", "country", "files"],
        fields: [],
      },
    })
    expect(rowCells(sub, buildColumns(spec, sources))).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "2026-09-22T08:45:00.000Z",
      "completed",
      "ur",
      "conversational",
      "reviewing",
      "shortlist, senior",
      "82",
      "score: 17",
      "utm_source=linkedin",
      "https://x.test",
      "mobile",
      "PK",
      "makingflow/submissions/ab12cd.pdf",
    ])
  })

  test("answers, removed answers and follow-ups land in their own columns", () => {
    const spec = exportSpecSchema.parse({
      columns: { meta: [], fields: "all", removedQuestions: true, aiFollowUps: true },
    })
    expect(rowCells(sub, buildColumns(spec, sources))).toEqual([
      "Ayesha",
      "https://res.test/cv.pdf",
      "Relocated",
      "Which stack?",
      "Postgres",
    ])
  })

  test("a missing follow-up is an empty cell, not a shifted row", () => {
    const spec = exportSpecSchema.parse({ columns: { meta: [], fields: [], aiFollowUps: true } })
    const cols = buildColumns(spec, { ...sources, followUpCount: 2 })
    expect(rowCells(sub, cols)).toEqual(["Which stack?", "Postgres", "", ""])
  })

  test("the JSON shape keys by header and nests follow-ups", () => {
    const spec = exportSpecSchema.parse({
      columns: { meta: ["submissionId"], fields: ["f1"], aiFollowUps: true },
      format: "json",
    })
    expect(rowObject(sub, buildColumns(spec, sources))).toEqual({
      "Submission ID": "11111111-1111-1111-1111-111111111111",
      "Full name": "Ayesha",
      aiFollowUps: [{ question: "Which stack?", answer: "Postgres" }],
    })
  })
})
