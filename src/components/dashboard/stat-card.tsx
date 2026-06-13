import { Icon, type IconName } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

export type Trend = { dir: "up" | "down" | "flat"; label: string }

/** A metric tile: icon chip, big value, label, and a trend badge. Server component. */
export function StatCard({
  label,
  value,
  icon,
  hint,
  trend,
}: {
  label: string
  value: string
  icon: IconName
  hint?: string
  trend?: Trend
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-lg bg-muted text-foreground">
          <Icon name={icon} className="size-[18px]" />
        </span>
        {trend ? (
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
      <p className="mt-3 font-sebenta text-2xl font-bold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {label}
        {hint ? <span className="text-muted-foreground/70"> · {hint}</span> : null}
      </p>
    </div>
  )
}
