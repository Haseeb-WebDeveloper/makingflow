import Link from "next/link"
import { DASHBOARD_RANGES, type DashboardRange } from "@/lib/data/range"
import { cn } from "@/lib/utils"

/**
 * Date-range selector for the dashboard chart.
 *
 * Deliberately links rather than state: the range is read on the server to
 * build the query, so putting it in the URL is what makes the page reflect it
 * at all. It also means a range is shareable, survives a reload, and works
 * before any JavaScript has run — none of which a client-side toggle would give.
 */
export function RangePicker({
  current,
  className,
}: {
  current: DashboardRange
  className?: string
}) {
  return (
    <nav aria-label="Chart date range" className={cn("flex flex-wrap gap-0.5", className)}>
      {DASHBOARD_RANGES.map((r) => {
        const active = r.key === current
        return (
          <Link
            key={r.key}
            href={`/forms?range=${r.key}`}
            scroll={false}
            aria-current={active ? "true" : undefined}
            // The long label is the accessible name; the short one is all that
            // fits seven options into a card header.
            aria-label={r.label}
            title={r.label}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {r.short}
          </Link>
        )
      })}
    </nav>
  )
}
