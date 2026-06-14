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
    <div className="rounded-lg lg:rounded-[0.694vw] border border-border p-4 lg:p-[1.111vw] sm:p-5">
      <p className="text-xs lg:text-[0.833vw] font-medium text-muted-foreground">Top countries</p>

      {top.length === 0 ? (
        <div className="flex h-52 lg:h-[14.444vw] items-center justify-center text-sm lg:text-[0.972vw] text-muted-foreground">
          No location data yet
        </div>
      ) : (
        <ul className="mt-3 lg:mt-[0.833vw] space-y-1.5 lg:space-y-[0.417vw]">
          {top.map((c) => {
            const share = peak > 0 ? c.count / peak : 0
            const code = c.key.toLowerCase()
            return (
              <li key={c.key} className="flex items-center gap-3 lg:gap-[0.833vw]">
                <div className="relative h-9 lg:h-[2.5vw] min-w-0 flex-1 overflow-hidden rounded-md lg:rounded-[0.556vw]">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md lg:rounded-[0.556vw] bg-primary/10"
                    style={{ width: `${Math.max(8, share * 100)}%` }}
                  />
                  <div className="relative flex h-full items-center gap-2.5 lg:gap-[0.694vw] px-2.5 lg:px-[0.694vw]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://flagcdn.com/32x24/${code}.png`}
                      srcSet={`https://flagcdn.com/64x48/${code}.png 2x`}
                      width={20}
                      height={15}
                      alt=""
                      className="h-[15px] lg:h-[1.042vw] w-5 lg:w-[1.389vw] shrink-0 rounded-[3px] lg:rounded-[0.208vw] object-cover ring-1 ring-border"
                    />
                    <span className="min-w-0 truncate text-sm lg:text-[0.972vw] text-foreground">
                      {countryName(c.key)}
                    </span>
                  </div>
                </div>
                <span className="w-10 lg:w-[2.778vw] shrink-0 text-right text-sm lg:text-[0.972vw] tabular-nums text-muted-foreground">
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
