/**
 * "Show this field if the start date is after X" used to evaluate false every
 * time, silently: the comparison ran `Number("2026-09-21")`, which is NaN, and
 * every NaN comparison is false. No error, no warning — the dependent field
 * simply never appeared.
 */
import { describe, expect, it } from "vitest"

import { testCondition } from "@/lib/builder/logic"

const cond = (operator: "greater_than" | "less_than", value: string) =>
  ({ fieldId: "d", operator, value }) as const

describe("date comparison in conditional logic", () => {
  it("orders dates chronologically", () => {
    expect(testCondition(cond("greater_than", "2026-01-01"), { d: "2026-09-21" })).toBe(true)
    expect(testCondition(cond("greater_than", "2026-12-01"), { d: "2026-09-21" })).toBe(false)
    expect(testCondition(cond("less_than", "2026-12-01"), { d: "2026-09-21" })).toBe(true)
    expect(testCondition(cond("less_than", "2026-01-01"), { d: "2026-09-21" })).toBe(false)
  })

  it("is exclusive at the boundary, like the operator says", () => {
    expect(testCondition(cond("greater_than", "2026-09-21"), { d: "2026-09-21" })).toBe(false)
    expect(testCondition(cond("less_than", "2026-09-21"), { d: "2026-09-21" })).toBe(false)
  })

  it("crosses year and month boundaries", () => {
    // The old string/number path got these wrong in both directions.
    expect(testCondition(cond("greater_than", "2025-12-31"), { d: "2026-01-01" })).toBe(true)
    expect(testCondition(cond("greater_than", "2026-09-09"), { d: "2026-09-10" })).toBe(true)
  })

  it("handles a date-time answer, and sorts a bare date before times that day", () => {
    expect(testCondition(cond("greater_than", "2026-09-21T09:00"), { d: "2026-09-21T14:30" })).toBe(true)
    expect(testCondition(cond("less_than", "2026-09-21T09:00"), { d: "2026-09-21T14:30" })).toBe(false)
    expect(testCondition(cond("greater_than", "2026-09-21"), { d: "2026-09-21T00:01" })).toBe(true)
  })

  it("orders times too", () => {
    expect(testCondition(cond("greater_than", "09:00"), { d: "14:30" })).toBe(true)
    expect(testCondition(cond("less_than", "09:00"), { d: "14:30" })).toBe(false)
  })

  it("still compares plain numbers numerically, not as text", () => {
    // "9" > "10" as strings; as numbers it is not.
    expect(testCondition(cond("greater_than", "10"), { d: 9 })).toBe(false)
    expect(testCondition(cond("greater_than", "9"), { d: 10 })).toBe(true)
    expect(testCondition(cond("less_than", "4.5"), { d: 2 })).toBe(true)
  })

  it("is false when the two sides cannot be ordered at all", () => {
    expect(testCondition(cond("greater_than", "banana"), { d: "apple" })).toBe(false)
    expect(testCondition(cond("greater_than", "2026-09-21"), { d: "not a date" })).toBe(false)
    expect(testCondition(cond("greater_than", "5"), { d: undefined })).toBe(false)
  })
})
