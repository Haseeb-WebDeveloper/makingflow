/**
 * The dashboard chart's date range.
 *
 * Pure and dependency-free on purpose: the range picker is a component and the
 * bucket maths is worth testing, and neither should have to pull in a Postgres
 * client to do its job. The SQL that USES a range lives in ./analytics.ts.
 */

export type DashboardRange = "3d" | "7d" | "14d" | "30d" | "3m" | "6m" | "all"

export const DEFAULT_RANGE: DashboardRange = "14d"

/** The picker's options, in the order they're shown. */
export const DASHBOARD_RANGES: { key: DashboardRange; label: string; short: string }[] = [
  { key: "3d", label: "Last 3 days", short: "3d" },
  { key: "7d", label: "Last 7 days", short: "7d" },
  { key: "14d", label: "Last 14 days", short: "14d" },
  { key: "30d", label: "Last 30 days", short: "30d" },
  { key: "3m", label: "Last 3 months", short: "3m" },
  { key: "6m", label: "Last 6 months", short: "6m" },
  { key: "all", label: "All time", short: "All" },
]

type Bucketing = { days: number | null; bucket: "day" | "week" | "month" }

/**
 * How each range is counted.
 *
 * Longer ranges widen the bucket rather than adding points. A year of daily
 * bars is 365 unreadable slivers; twelve monthly ones say the same thing. The
 * cut-offs are where a chart stops being legible at dashboard width, not round
 * numbers — `all` is monthly because it has no upper bound at all.
 */
const RANGE_BUCKETING: Record<DashboardRange, Bucketing> = {
  "3d": { days: 3, bucket: "day" },
  "7d": { days: 7, bucket: "day" },
  "14d": { days: 14, bucket: "day" },
  "30d": { days: 30, bucket: "day" },
  "3m": { days: 91, bucket: "week" },
  "6m": { days: 182, bucket: "week" },
  all: { days: null, bucket: "month" },
}

/** A ceiling on axis points, so a very old workspace can't render thousands. */
const MAX_BUCKETS = 400

/** A range from a URL parameter — anything unrecognised falls back to the default. */
export function parseRange(value: unknown): DashboardRange {
  return DASHBOARD_RANGES.some((r) => r.key === value)
    ? (value as DashboardRange)
    : DEFAULT_RANGE
}

/** Start of the bucket `d` falls in, matching Postgres `date_trunc` (ISO weeks). */
function truncateUTC(d: Date, bucket: Bucketing["bucket"]): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (bucket === "month") return new Date(Date.UTC(y, m, 1))
  const day = new Date(Date.UTC(y, m, d.getUTCDate()))
  if (bucket === "day") return day
  // date_trunc('week') is Monday-based; getUTCDay() is Sunday-based.
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day
}

function advanceUTC(d: Date, bucket: Bucketing["bucket"]): Date {
  const next = new Date(d)
  if (bucket === "month") next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCDate(next.getUTCDate() + (bucket === "week" ? 7 : 1))
  return next
}

/** YYYY-MM-DD keys for the last n days (UTC), oldest → newest. */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

/**
 * Every bucket in a range, so the series can be zero-filled into a continuous
 * line. A day with no submissions has no row to group, and without this the
 * chart would join two distant points as if nothing happened in between.
 */
export function rangeBuckets(
  range: DashboardRange,
  earliest?: Date | null,
): { keys: string[]; from: Date; bucket: Bucketing["bucket"] } {
  const { days, bucket } = RANGE_BUCKETING[range]
  const now = new Date()

  const start =
    days !== null
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)))
      : // All time runs from the first submission. An empty workspace still gets
        // an axis rather than a blank box.
        (earliest ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)))

  const from = truncateUTC(start, bucket)
  const end = truncateUTC(now, bucket)
  const keys: string[] = []
  for (let cur = from; cur <= end && keys.length < MAX_BUCKETS; cur = advanceUTC(cur, bucket)) {
    keys.push(cur.toISOString().slice(0, 10))
  }
  return { keys, from, bucket }
}
