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
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{field.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {TYPE_LABEL[field.type] ?? field.type} · {field.responses}{" "}
            {field.responses === 1 ? "response" : "responses"}
            {field.fillRate != null ? ` · ${pct(field.fillRate)} filled` : ""}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {field.responses === 0 ? (
          <p className="text-sm text-muted-foreground">No responses yet</p>
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
    <div className="space-y-2.5">
      {field.isMulti ? (
        <p className="text-xs text-muted-foreground">Multiple answers allowed</p>
      ) : null}
      {opts.map((o) => (
        <div key={o.label}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-foreground">{o.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {o.count} · {pct(o.percent)}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
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
  if (!n) return <p className="text-sm text-muted-foreground">No responses yet</p>
  const max = Math.max(1, ...n.distribution.map((d) => d.count))
  return (
    <div>
      <div className="flex items-baseline gap-5">
        <span>
          <span className="text-2xl font-bold tracking-tight text-foreground">
            {n.average.toFixed(1)}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">avg</span>
        </span>
        {n.nps ? (
          <span>
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {n.nps.score > 0 ? `+${n.nps.score}` : n.nps.score}
            </span>
            <span className="ml-1 text-xs text-muted-foreground">NPS</span>
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex h-20 items-end gap-1.5">
        {n.distribution.map((d) => (
          <div
            key={d.value}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d.value}: ${d.count}`}
          >
            <div
              className="w-full rounded-sm bg-primary/70"
              style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
            />
            <span className="text-[10px] text-muted-foreground">{d.value}</span>
          </div>
        ))}
      </div>

      {n.nps ? (
        <div className="mt-4">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
    <div className="space-y-3">
      {samples.length > 0 ? (
        <ul className="space-y-1.5">
          {samples.map((s, i) => (
            <li
              key={i}
              className="truncate rounded-md bg-muted/40 px-2.5 py-1.5 text-sm text-foreground"
            >
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {field.responses} {field.responses === 1 ? "response" : "responses"}
        </p>
      )}
      {/* <Link
        href={`/forms/${formId}/submissions`}
        className="inline-block text-xs font-medium text-primary hover:underline"
      >
        View all responses →
      </Link> */}
    </div>
  )
}
