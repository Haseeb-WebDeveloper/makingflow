import { Skeleton } from "@/components/ui/skeleton"

/**
 * Generic dashboard content skeleton — shown when navigating between dashboard
 * pages that don't ship a more specific `loading.tsx`. Mirrors the standard
 * page shell (header + a content block) so the layout doesn't jump.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
      <div className="mt-8 space-y-3">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}
