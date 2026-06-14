import Link from "next/link"
import type { FieldInsight } from "@/lib/data/form-insights"

const TYPE_LABEL: Record<string, string> = {
  short_text: "Short answer",
  long_text: "Long answer",
  email: "Email",
  phone: "Phone",
  url: "Link",
  multiple_choice: "Multiple choice",
  dropdown: "Dropdown",
  multi_select: "Multi-select",
  checkboxes: "Checkboxes",
  yes_no: "Yes / No",
  rating: "Rating",
  scale: "Linear scale",
  nps: "Net promoter",
  ranking: "Ranking",
  date: "Date",
  time: "Time",
  file_upload: "File upload",
  signature: "Signature",
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/** One card per form question, with a viz tuned to the field's type. Server component. */
export function FieldInsightCard({ field, formId }: { field: FieldInsight; formId: string }) {
  return (
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw] sm:p-5">
      <div className="flex items-start justify-between gap-3 lg:gap-[0.833vw]">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{field.label}</p>
          <p className="mt-0.5 lg:mt-[0.139vw] text-xs lg:text-[0.833vw] text-muted-foreground">
            {TYPE_LABEL[field.type] ?? field.type} · {field.responses}{" "}
            {field.responses === 1 ? "response" : "responses"}
            {field.fillRate != null ? ` · ${pct(field.fillRate)} filled` : ""}
          </p>
        </div>
      </div>

      <div className="mt-4 lg:mt-[1.111vw]">
        {field.responses === 0 ? (
          <p className="text-sm lg:text-[0.972vw] text-muted-foreground">No responses yet</p>
        ) : field.kind === "choice" ? (
          <ChoiceBars field={field} />
        ) : field.kind === "rating" ? (
          <NumericStat field={field} />
        ) : (
          <TextSamples field={field} formId={formId} />
        )}
      </div>
    </div>
  )
}

function ChoiceBars({ field }: { field: FieldInsight }) {
  const opts = [...(field.options ?? [])].sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...opts.map((o) => o.count))
  return (
    <div className="space-y-2.5 lg:space-y-[0.694vw]">
      {field.isMulti ? (
        <p className="text-xs lg:text-[0.833vw] text-muted-foreground">Multiple answers allowed</p>
      ) : null}
      {opts.map((o) => (
        <div key={o.label}>
          <div className="flex items-center justify-between gap-2 lg:gap-[0.556vw] text-sm lg:text-[0.972vw]">
            <span className="min-w-0 truncate text-foreground">{o.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {o.count} · {pct(o.percent)}
            </span>
          </div>
          <div className="mt-1 lg:mt-[0.278vw] h-2 lg:h-[0.556vw] overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, (o.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function NumericStat({ field }: { field: FieldInsight }) {
  const n = field.numeric
  if (!n) return <p className="text-sm lg:text-[0.972vw] text-muted-foreground">No responses yet</p>
  const max = Math.max(1, ...n.distribution.map((d) => d.count))
  return (
    <div>
      <div className="flex items-baseline gap-5 lg:gap-[1.389vw]">
        <span>
          <span className="font-sebenta text-2xl lg:text-[1.667vw] font-bold tracking-tight text-foreground">
            {n.average.toFixed(1)}
          </span>
          <span className="ml-1 lg:ml-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground">avg</span>
        </span>
        {n.nps ? (
          <span>
            <span className="font-sebenta text-2xl lg:text-[1.667vw] font-bold tracking-tight text-foreground">
              {n.nps.score > 0 ? `+${n.nps.score}` : n.nps.score}
            </span>
            <span className="ml-1 lg:ml-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground">NPS</span>
          </span>
        ) : null}
      </div>

      <div className="mt-4 lg:mt-[1.111vw] flex h-20 lg:h-[5.556vw] items-end gap-1.5 lg:gap-[0.417vw]">
        {n.distribution.map((d) => (
          <div
            key={d.value}
            className="flex flex-1 flex-col items-center gap-1 lg:gap-[0.278vw]"
            title={`${d.value}: ${d.count}`}
          >
            <div
              className="w-full rounded-sm lg:rounded-[0.463vw] bg-primary/70"
              style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
            />
            <span className="text-[10px] lg:text-[0.694vw] text-muted-foreground">{d.value}</span>
          </div>
        ))}
      </div>

      {n.nps ? (
        <div className="mt-4 lg:mt-[1.111vw]">
          <div className="flex h-2 lg:h-[0.556vw] overflow-hidden rounded-full bg-muted">
            <div
              className="bg-destructive"
              style={{ width: `${share(n.nps.detractors, n.nps)}%` }}
            />
            <div
              className="bg-muted-foreground/40"
              style={{ width: `${share(n.nps.passives, n.nps)}%` }}
            />
            <div className="bg-success" style={{ width: `${share(n.nps.promoters, n.nps)}%` }} />
          </div>
          <div className="mt-2 lg:mt-[0.556vw] flex flex-wrap gap-x-4 lg:gap-x-[1.111vw] gap-y-1 lg:gap-y-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground">
            <span className="text-success">{n.nps.promoters} promoters</span>
            <span>{n.nps.passives} passives</span>
            <span className="text-destructive">{n.nps.detractors} detractors</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function share(part: number, nps: { promoters: number; passives: number; detractors: number }) {
  const total = nps.promoters + nps.passives + nps.detractors || 1
  return (part / total) * 100
}

function TextSamples({ field, formId }: { field: FieldInsight; formId: string }) {
  const samples = field.samples ?? []
  return (
    <div className="space-y-3 lg:space-y-[0.833vw]">
      {samples.length > 0 ? (
        <ul className="space-y-1.5 lg:space-y-[0.417vw]">
          {samples.map((s, i) => (
            <li
              key={i}
              className="truncate rounded-md lg:rounded-[0.556vw] bg-muted/40 px-2.5 lg:px-[0.694vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-foreground"
            >
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm lg:text-[0.972vw] text-muted-foreground">
          {field.responses} {field.responses === 1 ? "response" : "responses"}
        </p>
      )}
      <Link
        href={`/forms/${formId}/submissions`}
        className="inline-block text-xs lg:text-[0.833vw] font-medium text-primary hover:underline"
      >
        View all responses →
      </Link>
    </div>
  )
}
