import { countryName } from "@/lib/format/geo"

type Bucket = { key: string; count: number }

/**
 * Top countries as a leaderboard: a proportional bar per country with its flag
 * (flagcdn.com) and name, the response count trailing. Server component.
 */
export function CountryLeaderboard({ items, max = 6 }: { items: Bucket[]; max?: number }) {
  const top = items.slice(0, max)
  const peak = top[0]?.count ?? 0

  return (
    <div className="rounded-lg border border-border p-4 sm:p-5">
      <p className="text-xs font-medium text-muted-foreground">Top countries</p>

      {top.length === 0 ? (
        <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
          No location data yet
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {top.map((c) => {
            const share = peak > 0 ? c.count / peak : 0
            const code = c.key.toLowerCase()
            return (
              <li key={c.key} className="flex items-center gap-3">
                <div className="relative h-9 min-w-0 flex-1 overflow-hidden rounded-md">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
                    style={{ width: `${Math.max(8, share * 100)}%` }}
                  />
                  <div className="relative flex h-full items-center gap-2.5 px-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://flagcdn.com/32x24/${code}.png`}
                      srcSet={`https://flagcdn.com/64x48/${code}.png 2x`}
                      width={20}
                      height={15}
                      alt=""
                      className="h-[15px] w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-border"
                    />
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {countryName(c.key)}
                    </span>
                  </div>
                </div>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {c.count.toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
