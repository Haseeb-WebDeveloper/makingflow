import type { DropOffField } from "@/lib/data/form-insights"

/**
 * "Where people drop off" — the questions where respondents most often stopped
 * on an unfinished draft. Same shape as the other breakdown cards (Sources,
 * Countries): most-abandoned first, a proportional bar, and the share of all
 * unfinished drafts. Pure server component; shows an empty state when nobody
 * has abandoned yet, so it can live permanently in the breakdown row.
 */
export function DropOffCard({
  total,
  fields,
}: {
  total: number
  fields: DropOffField[]
}) {
  const top = fields
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  return (
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw]">
      <div className="flex items-center justify-between gap-2 lg:gap-[0.556vw]">
        <p className="text-xs lg:text-[0.833vw] font-medium text-muted-foreground">Where people drop off</p>
        {total > 0 ? (
          <span className="shrink-0 tabular-nums text-xs lg:text-[0.833vw] text-muted-foreground">
            {total.toLocaleString()} unfinished
          </span>
        ) : null}
      </div>

      {top.length === 0 ? (
        <p className="mt-3 lg:mt-[0.833vw] text-sm lg:text-[0.972vw] text-muted-foreground">No drop-off yet</p>
      ) : (
        <ul className="mt-3 lg:mt-[0.833vw] space-y-2.5 lg:space-y-[0.694vw]">
          {top.map((f) => (
            <li key={f.id}>
              <div className="flex items-center justify-between gap-2 lg:gap-[0.556vw] text-sm lg:text-[0.972vw]">
                <span className="min-w-0 truncate text-foreground">{f.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Math.round(f.percent * 100)}%
                </span>
              </div>
              <div className="mt-1 lg:mt-[0.278vw] h-1.5 lg:h-[0.417vw] overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-destructive/50"
                  style={{ width: `${Math.max(2, f.percent * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
