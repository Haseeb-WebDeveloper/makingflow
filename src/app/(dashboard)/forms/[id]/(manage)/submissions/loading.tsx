import { Skeleton } from "@/components/ui/skeleton"

/** Submissions-tab skeleton: search/filter bar + a table of response rows. */
export default function SubmissionsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 lg:gap-[0.833vw]">
        <Skeleton className="h-9 lg:h-[2.5vw] w-64 lg:w-[17.778vw] max-w-[60%] rounded-md lg:rounded-[0.556vw]" />
        <Skeleton className="h-9 lg:h-[2.5vw] w-24 lg:w-[6.667vw] rounded-md lg:rounded-[0.556vw]" />
      </div>
      <div className="mt-4 lg:mt-[1.111vw] overflow-hidden rounded-lg lg:rounded-[0.694vw] border border-border">
        <Skeleton className="h-11 lg:h-[3.056vw] w-full rounded-none" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-t border-border px-4 lg:px-[1.111vw] py-3.5 lg:py-[0.972vw]">
            <Skeleton className="h-4 lg:h-[1.111vw] w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
