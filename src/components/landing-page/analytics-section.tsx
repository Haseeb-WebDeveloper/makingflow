import { Reveal } from "./reveal"

const TREND = [4, 6, 5, 9, 8, 12, 10, 15, 13, 18, 16, 22, 21, 27]

const STATS = [
  { label: "Views", value: "1,284", trend: "+18%", icon: "eye" as const },
  { label: "Submissions", value: "312", trend: "+9%", icon: "inbox" as const },
  { label: "Completion", value: "71%", trend: "+4%", icon: "check" as const },
  { label: "Avg. time", value: "1m 48s", trend: null, icon: "clock" as const },
]

const DROP_OFF = [
  { label: "Upload your resume", pct: 38 },
  { label: "Salary expectations", pct: 22 },
  { label: "Why this role?", pct: 11 },
]

export function AnalyticsSection() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-sm lg:text-[0.972vw] font-medium text-primary">Built-in analytics</p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 lg:mt-[1.111vw] max-w-2xl lg:max-w-[46.667vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            Every form keeps score, so you do not have to guess.
          </h2>
        </Reveal>
        <Reveal delay={140}>
          <p className="mt-4 lg:mt-[1.111vw] max-w-[58ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
            Views, completion rate, time to finish, and the exact question where
            people give up. No dashboards to wire up. It is just there, on every
            form.
          </p>
        </Reveal>

        <Reveal delay={220} className="mt-12 lg:mt-[3.333vw]">
          <div className="overflow-hidden rounded-xl lg:rounded-[0.926vw] border border-border bg-background shadow-lg">
            <div className="flex items-center gap-2 lg:gap-[0.556vw] border-b border-border bg-muted/40 px-4 lg:px-[1.111vw] py-2.5 lg:py-[0.694vw]">
              <span className="size-2.5 lg:size-[0.694vw] rounded-full bg-border" />
              <span className="size-2.5 lg:size-[0.694vw] rounded-full bg-border" />
              <span className="size-2.5 lg:size-[0.694vw] rounded-full bg-border" />
              <span className="ml-3 lg:ml-[0.833vw] text-sm lg:text-[0.972vw] font-medium text-foreground">Insights</span>
              <span className="ml-1.5 lg:ml-[0.417vw] text-sm lg:text-[0.972vw] text-muted-foreground">Senior designer application</span>
            </div>

            <div className="space-y-4 lg:space-y-[1.111vw] p-5 lg:p-[1.389vw] sm:p-6">
              <div className="grid grid-cols-2 gap-3 lg:gap-[0.833vw] lg:grid-cols-4">
                {STATS.map((s) => (
                  <StatTile key={s.label} {...s} />
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:gap-[0.833vw] lg:grid-cols-[1.6fr_1fr]">
                <TrendCard />
                <DropOffCard />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function StatTile({
  label,
  value,
  trend,
  icon,
}: {
  label: string
  value: string
  trend: string | null
  icon: "eye" | "inbox" | "check" | "clock"
}) {
  return (
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw]">
      <div className="flex items-center justify-between">
        <span className="grid size-8 lg:size-[2.222vw] place-items-center rounded-lg lg:rounded-[0.694vw] bg-muted text-foreground">
          <StatIcon name={icon} />
        </span>
        {trend ? (
          <span className="inline-flex items-center gap-0.5 lg:gap-[0.139vw] rounded-full bg-success/10 px-1.5 lg:px-[0.417vw] py-0.5 lg:py-[0.139vw] text-xs lg:text-[0.833vw] font-medium text-success">
            <svg viewBox="0 0 24 24" className="size-3 lg:size-[0.833vw]" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            {trend}
          </span>
        ) : null}
      </div>
      <p className="mt-3 lg:mt-[0.833vw] font-sebenta text-2xl lg:text-[1.667vw] font-bold tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 lg:mt-[0.139vw] text-xs lg:text-[0.833vw] text-muted-foreground">{label}</p>
    </div>
  )
}

function TrendCard() {
  const w = 320
  const h = 96
  const pad = 6
  const max = Math.max(...TREND)
  const stepX = w / (TREND.length - 1)
  const pts = TREND.map((d, i) => [i * stepX, h - (d / max) * (h - pad * 2) - pad] as const)
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const area = `${line} L${w} ${h} L0 ${h} Z`

  return (
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw]">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs lg:text-[0.833vw] font-medium text-muted-foreground">Submissions</p>
          <p className="mt-1 lg:mt-[0.278vw] font-sebenta text-2xl lg:text-[1.667vw] font-bold tracking-tight text-foreground">312</p>
        </div>
        <span className="text-xs lg:text-[0.833vw] text-muted-foreground">Last 14 days</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 lg:mt-[0.833vw] h-24 lg:h-[6.667vw] w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="lp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#lp-area)" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function DropOffCard() {
  return (
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw]">
      <p className="text-xs lg:text-[0.833vw] font-medium text-muted-foreground">Where people stop</p>
      <ul className="mt-3 lg:mt-[0.833vw] space-y-3 lg:space-y-[0.833vw]">
        {DROP_OFF.map((d) => (
          <li key={d.label} className="space-y-1.5 lg:space-y-[0.417vw]">
            <div className="flex items-center justify-between gap-2 lg:gap-[0.556vw] text-xs lg:text-[0.833vw]">
              <span className="truncate text-foreground">{d.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{d.pct}%</span>
            </div>
            <div className="h-1.5 lg:h-[0.417vw] overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${d.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatIcon({ name }: { name: "eye" | "inbox" | "check" | "clock" }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "size-4 lg:size-[1.111vw]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }
  if (name === "eye")
    return (
      <svg {...common}>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  if (name === "inbox")
    return (
      <svg {...common}>
        <path d="M4 13h4l1.5 3h5L16 13h4M4 13l2-7h12l2 7v5H4v-5Z" />
      </svg>
    )
  if (name === "check")
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}
