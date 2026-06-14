import { Skeleton } from "@/components/ui/skeleton"

/**
 * Generic dashboard content skeleton — shown when navigating between dashboard
 * pages that don't ship a more specific `loading.tsx`. Mirrors the standard
 * page shell (header + a content block) so the layout doesn't jump.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl lg:max-w-[80vw] px-6 lg:px-[1.667vw] py-8 lg:py-[2.222vw] sm:px-8">
      <div className="flex items-start justify-between gap-4 lg:gap-[1.111vw]">
        <div className="space-y-2 lg:space-y-[0.556vw]">
          <Skeleton className="h-7 lg:h-[1.944vw] w-40 lg:w-[11.111vw]" />
          <Skeleton className="h-4 lg:h-[1.111vw] w-72 lg:w-[20vw]" />
        </div>
        <Skeleton className="h-10 lg:h-[2.778vw] w-28 lg:w-[7.778vw] rounded-md lg:rounded-[0.556vw]" />
      </div>
      <div className="mt-8 lg:mt-[2.222vw] space-y-3 lg:space-y-[0.833vw]">
        <Skeleton className="h-64 lg:h-[17.778vw] w-full rounded-lg lg:rounded-[0.694vw]" />
        <Skeleton className="h-40 lg:h-[11.111vw] w-full rounded-lg lg:rounded-[0.694vw]" />
      </div>
    </div>
  )
}
