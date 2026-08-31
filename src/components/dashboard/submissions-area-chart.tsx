"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type Point = { day: string; count: number }

/** Featured submissions trend — smooth gradient area with an interactive tooltip. */
export function SubmissionsAreaChart({
  data,
  bucket = "day",
  toolbar,
}: {
  data: Point[]
  /** What one point covers, so the axis can say "Mar" instead of "Mar 3". */
  bucket?: "day" | "week" | "month"
  /** Range picker, rendered in the card header. */
  toolbar?: React.ReactNode
}) {
  const rows = data.map((d) => ({
    ...d,
    label: fmtBucket(d.day, bucket),
    tip: fmtTip(d.day, bucket),
  }))
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Submissions</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {total.toLocaleString()}
          </p>
        </div>
        {toolbar}
      </div>

      <div className="mt-4 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%" minHeight={176}>
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="mf-sub-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              interval="preserveStartEnd"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              width={32}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }} content={<ChartTip />} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--primary)"
              strokeWidth={2}
              fill="url(#mf-sub-fill)"
              dot={false}
              activeDot={{ r: 4, fill: "var(--primary)", stroke: "var(--background)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartTip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: { tip: string; count: number } }[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{p.tip}</p>
      <p className="text-muted-foreground">
        {p.count} {p.count === 1 ? "submission" : "submissions"}
      </p>
    </div>
  )
}

/**
 * A bucket start as an axis label.
 *
 * Monthly buckets drop the day — "Mar 1, Apr 1, May 1" reads as three arbitrary
 * dates, where "Mar, Apr, May" reads as three months. Weekly keeps the day,
 * because the week beginning matters.
 */
/**
 * The same bucket, spelled out for the tooltip.
 *
 * The axis has to stay short; the tooltip does not. "Mar 3" on a weekly chart
 * is ambiguous on its own — it is the week that starts there, not that day.
 */
function fmtTip(day: string, bucket: "day" | "week" | "month"): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(d)
  }
  const label = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
  return bucket === "week" ? `Week of ${label}` : label
}

function fmtBucket(day: string, bucket: "day" | "week" | "month"): string {
  const d = new Date(`${day}T00:00:00Z`)
  const opts: Intl.DateTimeFormatOptions =
    bucket === "month"
      ? { month: "short", year: "2-digit", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" }
  return new Intl.DateTimeFormat("en", opts).format(d)
}
