import { Skeleton } from "@/components/ui/skeleton"

/** Integrations-tab skeleton: a grid of integration cards. */
export default function IntegrationsLoading() {
  return (
    <div className="max-w-4xl">
      <Skeleton className="h-4 w-3/4" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
