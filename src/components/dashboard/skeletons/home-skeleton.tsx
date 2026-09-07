import {
  BreakdownSkeleton,
  ChartSkeleton,
  CountriesSkeleton,
  DevicesSkeleton,
} from "@/components/dashboard/skeletons/panels"
import { StatCard } from "@/components/dashboard/stat-card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The Home dashboard, mid-flight.
 *
 * TWO RULES, and they are the whole point:
 *
 *   1. Anything known before the query runs is rendered FOR REAL — the four
 *      metric labels and their icons, the "Submissions" and "Sources" panel
 *      titles, the "Your forms" heading, the table's column headers. A reader
 *      can already tell what they are waiting for, and none of it flickers into
 *      place when the data lands.
 *   2. Only the values are bars, and each bar occupies the box its value will.
 *
 * Built from the same wrappers the real page uses — `StatCard` with
 * `loading`, the same `rounded-lg border border-border p-4` panels, the same
 * grid — rather than a free-hand approximation. An approximation is right on
 * the day it is written and wrong after the first layout change, and nothing
 * fails when it drifts.
 */
export function HomeSkeleton() {
  return (
    <div className="mt-8 space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard loading label="Total submissions" icon="folder" />
        <StatCard loading label="This week" icon="chart" />
        <StatCard loading label="Active forms" icon="document" />
        <StatCard loading label="Completion rate" icon="tick-square" />
      </div>

      <ChartSkeleton toolbar />

      {/* Three different components, so three different shapes. Reusing one
          bar-list placeholder for all of them was quicker and wrong: Devices is
          a donut and Countries is a row of flag chips, and a reader who sees
          bars there watches the layout rearrange itself when the data lands. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BreakdownSkeleton title="Sources" />
        <DevicesSkeleton />
        <CountriesSkeleton />
      </div>

      <div className="pt-2">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Your forms</h2>
        <FormsTableSkeleton />
      </div>
    </div>
  )
}

/**
 * The forms table with its real header row.
 *
 * The columns are fixed and known — Form, Trend, Responses, Completion, Status
 * — so they are rendered as text at the widths the real table uses. Only the
 * rows are unknown.
 */
function FormsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              Form
            </th>
            <th className="w-28 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              Trend
            </th>
            <th className="w-28 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              Responses
            </th>
            <th className="w-36 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              Completion
            </th>
            <th className="w-28 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              Status
            </th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }, (_, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <Skeleton className="h-4" style={{ width: `${64 - i * 9}%` }} />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-16" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-10" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-5 w-16 rounded-full" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="size-4 rounded" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
