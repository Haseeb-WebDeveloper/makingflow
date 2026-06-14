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
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw]">
      <div className="flex items-center justify-between">
        <span className="grid size-9 lg:size-[2.5vw] place-items-center rounded-lg lg:rounded-[0.694vw] bg-muted text-foreground">
          <Icon name={icon} className="size-[18px] lg:size-[1.25vw]" />
        </span>
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 lg:gap-[0.139vw] rounded-full px-1.5 lg:px-[0.417vw] py-0.5 lg:py-[0.139vw] text-xs lg:text-[0.833vw] font-medium",
              trend.dir === "up" && "bg-success/10 text-success",
              trend.dir === "down" && "bg-destructive/10 text-destructive",
              trend.dir === "flat" && "bg-muted text-muted-foreground",
            )}
          >
            {trend.dir !== "flat" ? (
              <svg
                viewBox="0 0 24 24"
                className={cn("size-3 lg:size-[0.833vw]", trend.dir === "down" && "rotate-180")}
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
      <p className="mt-3 lg:mt-[0.833vw] font-sebenta text-2xl lg:text-[1.667vw] font-bold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-0.5 lg:mt-[0.139vw] text-xs lg:text-[0.833vw] text-muted-foreground">
        {label}
        {hint ? <span className="text-muted-foreground/70"> · {hint}</span> : null}
      </p>
    </div>
  )
}
