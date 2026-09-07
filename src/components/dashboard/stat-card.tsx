import { Icon, type IconName } from "@/components/ui/icon"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type Trend = { dir: "up" | "down" | "flat"; label: string }

/**
 * A metric tile: icon chip, big value, label, and a trend badge. Server component.
 *
 * `loading` renders the SAME tile with the number and trend replaced by bars.
 * Not a separate skeleton component, deliberately: the loading and loaded
 * states cannot drift apart if they are the same markup, and the label and icon
 * are known before the query runs — so "Total submissions" and its chip appear
 * immediately rather than as two grey rectangles that resolve into text.
 */
export function StatCard({
  label,
  value,
  icon,
  hint,
  trend,
  loading = false,
}: {
  label: string
  /** Absent while `loading`. */
  value?: string
  icon: IconName
  hint?: string
  trend?: Trend
  loading?: boolean
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-lg bg-muted text-foreground">
          <Icon name={icon} className="size-[18px]" />
        </span>
        {loading ? (
          <Skeleton className="h-5 w-12 rounded-full" />
        ) : trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
              trend.dir === "up" && "bg-success/10 text-success",
              trend.dir === "down" && "bg-destructive/10 text-destructive",
              trend.dir === "flat" && "bg-muted text-muted-foreground",
            )}
          >
            {trend.dir !== "flat" ? (
              <svg
                viewBox="0 0 24 24"
                className={cn("size-3", trend.dir === "down" && "rotate-180")}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            ) : null}
            {trend.label}
          </span>
        ) : null}
      </div>
      {loading ? (
        // h-8 matches the rendered height of text-2xl/font-bold, so the tile
        // does not change height when the number arrives.
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">
          {value}
        </p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {label}
        {hint ? <span className="text-muted-foreground/70"> · {hint}</span> : null}
      </p>
    </div>
  )
}
