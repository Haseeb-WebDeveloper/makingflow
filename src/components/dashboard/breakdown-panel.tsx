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
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {top.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {top.map((i) => {
            const share = total > 0 ? i.count / total : 0
            return (
              <li key={i.label}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{i.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
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
