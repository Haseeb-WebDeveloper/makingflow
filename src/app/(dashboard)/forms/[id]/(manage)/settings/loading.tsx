import { Skeleton } from "@/components/ui/skeleton"

/** Settings-tab skeleton: a few labelled setting sections. */
export default function FormSettingsLoading() {
  return (
    <div className="max-w-2xl lg:max-w-[46.667vw] space-y-8 lg:space-y-[2.222vw]">
      {Array.from({ length: 3 }).map((_, s) => (
        <div key={s}>
          <Skeleton className="mb-2 lg:mb-[0.556vw] h-4 lg:h-[1.111vw] w-32 lg:w-[8.889vw]" />
          <div className="rounded-lg lg:rounded-[0.694vw] border border-border px-4 lg:px-[1.111vw]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 lg:gap-[1.111vw] border-b border-border py-4 lg:py-[1.111vw] last:border-0"
              >
                <div className="min-w-0 flex-1 space-y-2 lg:space-y-[0.556vw]">
                  <Skeleton className="h-4 lg:h-[1.111vw] w-40 lg:w-[11.111vw]" />
                  <Skeleton className="h-3 lg:h-[0.833vw] w-64 lg:w-[17.778vw] max-w-full" />
                </div>
                <Skeleton className="h-6 lg:h-[1.667vw] w-10 lg:w-[2.778vw] shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
