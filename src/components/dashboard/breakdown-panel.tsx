export type BreakdownItem = { label: string; count: number }

/**
 * A labeled list of proportional bars (devices, countries, sources…). Shows the
 * top `max` rows by share. Pure server component.
 */
export function BreakdownPanel({
  title,
  items,
  empty,
  max = 5,
}: {
  title: string
  items: BreakdownItem[]
  empty: string
  max?: number
}) {
  const total = items.reduce((sum, i) => sum + i.count, 0)
  const top = items.slice(0, max)

  return (
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw]">
      <p className="text-xs lg:text-[0.833vw] font-medium text-muted-foreground">{title}</p>
      {top.length === 0 ? (
        <p className="mt-3 lg:mt-[0.833vw] text-sm lg:text-[0.972vw] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 lg:mt-[0.833vw] space-y-2.5 lg:space-y-[0.694vw]">
          {top.map((i) => {
            const share = total > 0 ? i.count / total : 0
            return (
              <li key={i.label}>
                <div className="flex items-center justify-between gap-2 lg:gap-[0.556vw] text-sm lg:text-[0.972vw]">
                  <span className="min-w-0 truncate text-foreground">{i.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="mt-1 lg:mt-[0.278vw] h-1.5 lg:h-[0.417vw] overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.max(2, share * 100)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
