import {
  BreakdownSkeleton,
  ChartSkeleton,
  CountriesSkeleton,
  DevicesSkeleton,
} from "@/components/dashboard/skeletons/panels"
import { StatCard } from "@/components/dashboard/stat-card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * A form's Insights tab, loading.
 *
 * The form's name and the tab bar come from the layout and are already on
 * screen, so this is only the content area. Within it the four metric labels,
 * the panel titles and the "Question breakdown" heading are all fixed — the
 * numbers behind them are not.
 *
 * The panels are the same components the workspace dashboard uses, so they
 * share one set of placeholders rather than two that drift.
 */
export default function FormInsightsLoading() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard loading label="Views" icon="show" />
        <StatCard loading label="Unique visitors" icon="profile" />
        <StatCard loading label="Submissions" icon="folder" />
        <StatCard loading label="Completion rate" icon="tick-square" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartSkeleton />
        </div>
        <DevicesSkeleton />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BreakdownSkeleton title="Sources" />
        <BreakdownSkeleton title="Drop-off" rows={4} />
        <CountriesSkeleton />
      </div>

      <div className="pt-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">
          Question breakdown
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <Skeleton className="h-4" style={{ width: `${62 - i * 8}%` }} />
              <Skeleton className="mt-2 h-3.5 w-24" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 3 }, (_, j) => (
                  <div key={j}>
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-4" style={{ width: `${50 - j * 8}%` }} />
                      <Skeleton className="h-4 w-8 shrink-0" />
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
