import { Skeleton } from "@/components/ui/skeleton"

/** Integrations-tab skeleton: a grid of integration cards. */
export default function IntegrationsLoading() {
  return (
    <div className="max-w-4xl lg:max-w-[62.222vw]">
      <Skeleton className="h-4 lg:h-[1.111vw] w-3/4" />
      <div className="mt-5 lg:mt-[1.389vw] grid grid-cols-1 gap-3 lg:gap-[0.833vw] sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 lg:h-[12.222vw] w-full rounded-lg lg:rounded-[0.694vw]" />
        ))}
      </div>
    </div>
  )
}
