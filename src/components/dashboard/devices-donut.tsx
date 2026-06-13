"use client"

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

type Bucket = { key: string; count: number }

// Fixed device set so the legend always shows the full set, even at 0%.
const DEVICE_ORDER = ["desktop", "mobile", "tablet"] as const
const COLOR: Record<string, string> = {
  desktop: "var(--chart-1)",
  mobile: "var(--chart-3)",
  tablet: "var(--chart-4)",
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function DonutTip({
  active,
  payload,
  total,
}: {
  active?: boolean
  payload?: { value: number }[]
  total?: number
}) {
  if (!active || !payload?.length) return null
  const value = payload[0].value
  const share = total && total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-sm">
      <p className="font-semibold">{share}%</p>
      <p className="opacity-80">
        {value} {value === 1 ? "response" : "responses"}
      </p>
    </div>
  )
}

/** Devices donut with a centered total, hover tooltip, and a 2-column legend. */
export function DevicesDonut({ items }: { items: Bucket[] }) {
  const counts = new Map(items.map((i) => [i.key, i.count]))
  const total = items.reduce((s, i) => s + i.count, 0)
  // Always render all device types so the legend communicates the full set.
  const data = DEVICE_ORDER.map((key) => ({
    name: cap(key),
    value: counts.get(key) ?? 0,
    color: COLOR[key],
  }))

  return (
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <p className="text-xs font-medium text-muted-foreground">Devices</p>

      {total === 0 ? (
        <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
          No device data yet
        </div>
      ) : (
        <div className="mt-1 flex flex-col items-center">
          <div className="relative h-40 w-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={data.length > 1 ? 3 : 0}
                  cornerRadius={4}
                  stroke="var(--background)"
                  strokeWidth={2}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTip total={total} />} cursor={false} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-sebenta text-2xl font-bold tracking-tight text-foreground">
                {total.toLocaleString()}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                responses
              </span>
            </div>
          </div>

          <ul className="mt-5 grid w-full grid-cols-2 gap-x-4 gap-y-2">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                  <span className="truncate text-foreground">{d.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Math.round((d.value / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
