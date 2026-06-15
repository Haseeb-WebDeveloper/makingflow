import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getFormsDashboard } from "@/lib/data/analytics";
import {
  PageContainer,
  PageHeader,
  EmptyState,
} from "@/components/dashboard/page-shell";
import { StatCard, type Trend } from "@/components/dashboard/stat-card";
import { CountryLeaderboard } from "@/components/dashboard/country-leaderboard";
import { BreakdownPanel } from "@/components/dashboard/breakdown-panel";
import { FormsOverviewTable } from "@/components/dashboard/forms-overview-table";
import { SVGIcon } from "@/components/ui/svg-icon";

// Code-split the recharts-backed charts (~90KB) into their own chunk — they sit
// below the stat cards, so deferring them speeds up the dashboard's first paint.
const SubmissionsAreaChart = dynamic(() =>
  import("@/components/dashboard/submissions-area-chart").then(
    (m) => m.SubmissionsAreaChart
  )
);
const DevicesDonut = dynamic(() =>
  import("@/components/dashboard/devices-donut").then((m) => m.DevicesDonut)
);

export const metadata: Metadata = { title: "Home · MakingFlow" };

const NewFormButton = () => (
  <Link
    href="/forms/new"
    className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
  >
    New form
  </Link>
);

export default async function FormsPage() {
  const data = await getFormsDashboard();
  const totals = data?.totals;
  const forms = data?.forms ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Home"
        description="An overview of your forms and how they're performing."
        // action={<NewFormButton />}
      />

      {forms.length === 0 || !totals ? (
        <EmptyState
          icon="document"
          title="No forms yet"
          description="Describe a form in plain language and MakingFlow will build it for you."
          action={
            <Link
              href="/forms/new"
              className="inline-flex h-10 gap-1.5 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              <SVGIcon src="/icons/plus.svg" className="size-4" />
              New form
            </Link>
          }
        />
      ) : (
        <div className="mt-8 space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Total submissions"
              icon="folder"
              value={totals.totalSubmissions.toLocaleString()}
              trend={
                totals.submissionsThisWeek > 0
                  ? {
                      dir: "up",
                      label: `${totals.submissionsThisWeek} this week`,
                    }
                  : { dir: "flat", label: "No new" }
              }
            />
            <StatCard
              label="This week"
              icon="chart"
              value={totals.submissionsThisWeek.toLocaleString()}
              trend={weekTrend(
                totals.submissionsThisWeek,
                totals.submissionsPrevWeek
              )}
            />
            <StatCard
              label="Active forms"
              icon="document"
              value={totals.activeForms.toLocaleString()}
              hint={`of ${totals.totalForms}`}
            />
            <StatCard
              label="Completion rate"
              icon="tick-square"
              value={pct(totals.completionRate)}
              hint={
                totals.completionRate != null
                  ? `${totals.completes}/${totals.views} views`
                  : "no views yet"
              }
            />
          </div>

          <SubmissionsAreaChart data={data!.series} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <BreakdownPanel
              title="Sources"
              items={data!.breakdowns.sources.map((s) => ({
                label: s.key,
                count: s.count,
              }))}
              empty="No source data yet"
              max={6}
            />
            <DevicesDonut items={data!.breakdowns.devices} />
            <CountryLeaderboard items={data!.breakdowns.countries} />
          </div>

          <div className="pt-2">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Your forms
            </h2>
            <FormsOverviewTable forms={forms} />
          </div>
        </div>
      )}
    </PageContainer>
  );
}

/** Completion rate as a clamped percentage, or an em dash with no view data. */
function pct(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.min(100, Math.round(rate * 100))}%`;
}

function weekTrend(week: number, prev: number): Trend {
  if (prev === 0) {
    return week > 0 ? { dir: "up", label: "New" } : { dir: "flat", label: "—" };
  }
  const delta = Math.round(((week - prev) / prev) * 100);
  return {
    dir: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    label: `${Math.abs(delta)}%`,
  };
}
