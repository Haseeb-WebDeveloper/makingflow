import type { Metadata } from "next"
import dynamic from "next/dynamic"
import { notFound } from "next/navigation"
import { getFormInsights } from "@/lib/data/form-insights"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { StatCard } from "@/components/dashboard/stat-card"
import { CountryLeaderboard } from "@/components/dashboard/country-leaderboard"
import { BreakdownPanel } from "@/components/dashboard/breakdown-panel"
import { DropOffCard } from "@/components/dashboard/drop-off-card"
import { FieldInsightCard } from "@/components/dashboard/field-insight-card"

// Code-split the recharts charts so they don't weigh down the insights tab's
// initial JS (they render below the stat cards).
const SubmissionsAreaChart = dynamic(() =>
  import("@/components/dashboard/submissions-area-chart").then((m) => m.SubmissionsAreaChart),
)
const DevicesDonut = dynamic(() =>
  import("@/components/dashboard/devices-donut").then((m) => m.DevicesDonut),
)

export const metadata: Metadata = { title: "Insights · MakingFlow" }

const pct = (r: number | null) => (r == null ? "—" : `${Math.min(100, Math.round(r * 100))}%`)

/**
 * The form's default management view (Insights) — served directly at
 * /forms/[id], no redirect hop. Opening a form is a single navigation.
 */
export default async function InsightsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()
  const data = await getFormInsights(id, workspace.id)
  if (!data) notFound()

  const { totals, fields, dropOff } = data
  const hasResponses = totals.submissions > 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Views" icon="show" value={totals.views.toLocaleString()} />
        <StatCard
          label="Unique visitors"
          icon="profile"
          value={totals.uniqueVisitors.toLocaleString()}
        />
        <StatCard label="Submissions" icon="folder" value={totals.submissions.toLocaleString()} />
        <StatCard
          label="Completion rate"
          icon="tick-square"
          value={pct(totals.completionRate)}
          hint={totals.completionRate != null ? `of ${totals.views} views` : "no views yet"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SubmissionsAreaChart data={data.series} />
        </div>
        <DevicesDonut items={data.breakdowns.devices} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BreakdownPanel
          title="Sources"
          items={data.breakdowns.sources.map((s) => ({ label: s.key, count: s.count }))}
          empty="No source data yet"
          max={6}
        />
        <DropOffCard total={dropOff.total} fields={dropOff.fields} />
        <CountryLeaderboard items={data.breakdowns.countries} />
      </div>

      <div className="pt-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Question breakdown</h2>
        {!hasResponses ? (
          <p className="mb-3 text-sm text-muted-foreground">
            No responses yet. Share your form to start collecting.
          </p>
        ) : null}
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">This form has no questions yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {fields.map((f) => (
              <FieldInsightCard key={f.id} field={f} formId={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
