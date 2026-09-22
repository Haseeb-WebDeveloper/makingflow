import { describe, expect, test } from "vitest"
import {
  DEFAULT_SPEC,
  decodeSpec,
  encodeSpec,
  exportSpecSchema,
  isSyncEligible,
  parseExportSpec,
  safeTimezone,
  SYNC_ROW_CEILING,
} from "@/lib/submissions/export-spec"

describe("export spec", () => {
  test("an empty request is today's export: completed rows, CSV, submitted column, file URLs", () => {
    expect(DEFAULT_SPEC).toEqual({
      format: "csv",
      scope: { status: "completed", filters: [], match: "all", order: "oldest" },
      columns: { meta: ["submitted"], fields: "all", removedQuestions: false, aiFollowUps: false },
      files: "urls",
      timezone: "UTC",
    })
  })

  test("parseExportSpec with no params returns the default", () => {
    expect(parseExportSpec(new URLSearchParams())).toEqual(DEFAULT_SPEC)
  })

  test("a spec survives the round trip through a query parameter", () => {
    const spec = exportSpecSchema.parse({
      format: "xlsx",
      scope: { status: "all", search: "karachi", limit: 50, order: "newest" },
      columns: { meta: ["submissionId", "submitted", "aiScore"], fields: ["f1", "f2"], aiFollowUps: true },
      files: "zip",
      timezone: "Asia/Karachi",
    })
    const params = new URLSearchParams({ spec: encodeSpec(spec) })
    expect(parseExportSpec(params)).toEqual(spec)
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec)
  })

  test("a mangled spec falls back to the default rather than failing the download", () => {
    expect(parseExportSpec(new URLSearchParams({ spec: "not-base64-json" }))).toEqual(DEFAULT_SPEC)
  })

  test("an unknown timezone degrades to UTC", () => {
    expect(safeTimezone("Mars/Olympus_Mons")).toBe("UTC")
    expect(safeTimezone("Asia/Karachi")).toBe("Asia/Karachi")
    expect(safeTimezone(undefined)).toBe("UTC")
  })

  test("only small csv/json exports without a zip may stream inline", () => {
    const csv = DEFAULT_SPEC
    expect(isSyncEligible(csv, SYNC_ROW_CEILING)).toBe(true)
    expect(isSyncEligible(csv, SYNC_ROW_CEILING + 1)).toBe(false)
    expect(isSyncEligible({ ...csv, format: "xlsx" }, 10)).toBe(false)
    expect(isSyncEligible({ ...csv, files: "zip" }, 10)).toBe(false)
    expect(isSyncEligible({ ...csv, files: "zip-only" }, 10)).toBe(false)
    expect(isSyncEligible({ ...csv, format: "json" }, 10)).toBe(true)
  })

  test("filters are capped so a signed link cannot carry an unbounded workload", () => {
    const many = Array.from({ length: 25 }, () => ({ fieldId: "f", operator: "is_not_empty" as const }))
    expect(() => exportSpecSchema.parse({ scope: { filters: many } })).toThrow()
  })
})
