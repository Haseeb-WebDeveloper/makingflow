/**
 * The dashboard chart's date range.
 *
 * Two things here are easy to get wrong and invisible when you do: the number
 * of buckets in a range (off by one either drops today or invents a day that
 * hasn't happened), and week alignment — these keys are matched against
 * Postgres `date_trunc('week', …)` output, which is Monday-based, so a
 * Sunday-based week would zero-fill every real bucket and chart a flat line.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { DASHBOARD_RANGES, parseRange, rangeBuckets } from "@/lib/data/range"

/** A Wednesday, so week truncation has somewhere to move back to. */
const NOW = new Date("2026-08-19T14:30:00Z")

function at(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => vi.useRealTimers())

describe("parseRange", () => {
  test("accepts every option the picker offers", () => {
    for (const r of DASHBOARD_RANGES) expect(parseRange(r.key)).toBe(r.key)
  })

  test("falls back rather than throwing on a hand-edited URL", () => {
    // This value comes straight from a query string.
    expect(parseRange("nonsense")).toBe("14d")
    expect(parseRange(undefined)).toBe("14d")
    expect(parseRange("")).toBe("14d")
    expect(parseRange(["7d"])).toBe("14d")
    expect(parseRange("__proto__")).toBe("14d")
  })
})

describe("rangeBuckets", () => {
  test("a day range covers exactly that many days, ending today", () => {
    at(NOW.toISOString())
    const { keys, bucket } = rangeBuckets("7d")
    expect(bucket).toBe("day")
    expect(keys).toHaveLength(7)
    expect(keys[keys.length - 1]).toBe("2026-08-19")
    expect(keys[0]).toBe("2026-08-13")
  })

  test("counts today as a whole bucket regardless of the time of day", () => {
    at("2026-08-19T00:00:01Z")
    expect(rangeBuckets("3d").keys).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"])
    vi.useRealTimers()
    at("2026-08-19T23:59:59Z")
    expect(rangeBuckets("3d").keys).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"])
  })

  test("weekly buckets start on Monday, matching date_trunc", () => {
    at(NOW.toISOString()) // Wednesday 19 Aug 2026
    const { keys, bucket } = rangeBuckets("6m")
    expect(bucket).toBe("week")
    // Every key must be a Monday, or none of them will match a grouped row.
    for (const k of keys) expect(new Date(`${k}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(keys[keys.length - 1]).toBe("2026-08-17")
  })

  test("monthly buckets start on the first", () => {
    at(NOW.toISOString())
    const { keys, bucket } = rangeBuckets("all", new Date("2026-03-14T09:00:00Z"))
    expect(bucket).toBe("month")
    expect(keys).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ])
  })

  test("all-time starts at the first submission, not at a fixed window", () => {
    at(NOW.toISOString())
    const keys = rangeBuckets("all", new Date("2024-11-02T00:00:00Z")).keys
    expect(keys[0]).toBe("2024-11-01")
    expect(keys[keys.length - 1]).toBe("2026-08-01")
  })

  test("all-time on an empty workspace still produces an axis", () => {
    // Nothing to chart is not the same as nothing to draw — a blank box reads
    // as broken.
    at(NOW.toISOString())
    const keys = rangeBuckets("all", null).keys
    expect(keys.length).toBeGreaterThan(0)
    expect(keys[keys.length - 1]).toBe("2026-08-01")
  })

  test("caps the axis for an implausibly old workspace", () => {
    at(NOW.toISOString())
    const keys = rangeBuckets("all", new Date("1990-01-01T00:00:00Z")).keys
    expect(keys.length).toBeLessThanOrEqual(400)
  })

  test("`from` is the start of the first bucket, so the query and the fill agree", () => {
    at(NOW.toISOString())
    for (const r of DASHBOARD_RANGES) {
      const { keys, from } = rangeBuckets(r.key, new Date("2026-01-15T00:00:00Z"))
      // A `from` later than the first key would exclude rows the chart then
      // zero-fills — a real bucket silently rendered as empty.
      expect(from.toISOString().slice(0, 10)).toBe(keys[0])
    }
  })
})
