import { Skeleton } from "@/components/ui/skeleton"

/**
 * The analytics panels, mid-flight.
 *
 * Shared because the workspace dashboard and a form's Insights tab render the
 * same four components — an area chart, a sources breakdown, a devices donut
 * and a country leaderboard. Two copies of each placeholder would be two things
 * to keep in step with one component, and the copy nobody is looking at is the
 * one that goes stale.
 *
 * Every panel title is real: they are fixed strings, and a reader can tell what
 * is arriving before it does.
 */

/** SubmissionsAreaChart: header row with the total, then the h-44 plot. */
export function ChartSkeleton({ toolbar = false }: { toolbar?: boolean }) {
  return (
    <div className="h-full rounded-lg border border-border p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Submissions</p>
          <Skeleton className="mt-1 h-8 w-24" />
        </div>
        {/* Only the workspace dashboard puts a range picker up here. */}
        {toolbar ? <Skeleton className="h-8 w-44 rounded-md" /> : null}
      </div>
      <Skeleton className="mt-4 h-44 w-full rounded-md" />
    </div>
  )
}

/** BreakdownPanel: real title, then label/count rows over their meters. */
export function BreakdownSkeleton({
  title,
  rows = 5,
}: {
  title: string
  rows?: number
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="mt-3 space-y-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <div className="flex items-center justify-between gap-2">
              {/* Descending widths: a column of identical bars reads as a
                  loading pattern, a ragged one reads as a list of names. */}
              <Skeleton className="h-4" style={{ width: `${58 - i * 7}%` }} />
              <Skeleton className="h-4 w-8 shrink-0" />
            </div>
            {/* The empty meter track, exactly as BreakdownPanel draws it. */}
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** DevicesDonut: a 160px ring with the total in the hole, then a 2-up legend. */
export function DevicesSkeleton() {
  return (
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <p className="text-xs font-medium text-muted-foreground">Devices</p>
      <div className="mt-1 flex flex-col items-center">
        <div className="relative h-40 w-40">
          {/* A ring, not a filled disc — the donut has a hole with the total in
              it, so a solid circle would collapse inward when data lands. */}
          <div className="absolute inset-0 rounded-full border-[18px] border-muted" />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-2.5 w-14" />
          </div>
        </div>
        <ul className="mt-5 grid w-full grid-cols-2 gap-x-4 gap-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-6 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** CountryLeaderboard: "Top countries", then h-9 chips with a flag and a count. */
export function CountriesSkeleton() {
  return (
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <p className="text-xs font-medium text-muted-foreground">Top countries</p>
      <ul className="mt-3 space-y-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <div className="relative h-9 min-w-0 flex-1 overflow-hidden rounded-md bg-muted/50">
              <div className="relative flex h-full items-center gap-2.5 px-2.5">
                {/* The flag, at the exact 20x15 the real one renders. */}
                <Skeleton className="h-[15px] w-5 shrink-0 rounded-[3px]" />
                <Skeleton className="h-4" style={{ width: `${52 - i * 6}%` }} />
              </div>
            </div>
            <Skeleton className="h-4 w-10 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  )
}
