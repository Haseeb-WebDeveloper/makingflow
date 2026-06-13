import type { Metadata } from "next"
import { Icon } from "@/components/ui/icon"

export const metadata: Metadata = { title: "Insights · MakingFlow" }

const METRICS = [
  { label: "Visits", hint: "needs view tracking" },
  { label: "Submissions", hint: "see Submissions tab" },
  { label: "Completion rate", hint: "needs view tracking" },
  { label: "Avg. completion time", hint: "needs view tracking" },
]

export default function InsightsPage() {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.label} className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="mt-1 font-sebenta text-2xl font-bold text-muted-foreground/40">—</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon name="chart" className="size-5" />
        </span>
        <p className="text-sm font-medium text-foreground">Insights are coming soon</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Visits, drop-offs, and completion analytics need visitor tracking, which we&apos;re
          wiring up next. Responses are already available in the Submissions tab — or ask the
          AI assistant below to summarize them.
        </p>
      </div>
    </div>
  )
}
