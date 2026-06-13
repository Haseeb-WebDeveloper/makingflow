import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getFormInsights } from "@/lib/data/form-insights"
import { StatCard } from "@/components/dashboard/stat-card"
import { SubmissionsAreaChart } from "@/components/dashboard/submissions-area-chart"
import { DevicesDonut } from "@/components/dashboard/devices-donut"
import { CountryLeaderboard } from "@/components/dashboard/country-leaderboard"
import { BreakdownPanel } from "@/components/dashboard/breakdown-panel"
import { FieldInsightCard } from "@/components/dashboard/field-insight-card"

export const metadata: Metadata = { title: "Insights · MakingFlow" }

const pct = (r: number | null) => (r == null ? "—" : `${Math.min(100, Math.round(r * 100))}%`)

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await getFormInsights(id)
  if (!data) notFound()

  const { totals, fields } = data
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

      <SubmissionsAreaChart data={data.series} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BreakdownPanel
          title="Sources"
          items={data.breakdowns.sources.map((s) => ({ label: s.key, count: s.count }))}
          empty="No source data yet"
          max={6}
        />
        <DevicesDonut items={data.breakdowns.devices} />
        <CountryLeaderboard items={data.breakdowns.countries} />
      </div>

      <div className="pt-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Question breakdown</h2>
        {!hasResponses ? (
          <p className="mb-3 text-sm text-muted-foreground">
            No responses yet — share your form to start collecting.
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
