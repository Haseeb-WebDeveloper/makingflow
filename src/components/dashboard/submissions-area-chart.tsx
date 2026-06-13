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
export function SubmissionsAreaChart({ data }: { data: Point[] }) {
  const rows = data.map((d) => ({ ...d, label: fmtShort(d.day) }))
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Submissions</p>
          <p className="mt-1 font-sebenta text-2xl font-bold tracking-tight text-foreground">
            {total.toLocaleString()}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">Last 14 days</span>
      </div>

      <div className="mt-4 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
  payload?: { payload: { label: string; count: number } }[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{p.label}</p>
      <p className="text-muted-foreground">
        {p.count} {p.count === 1 ? "submission" : "submissions"}
      </p>
    </div>
  )
}

function fmtShort(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(d)
}
