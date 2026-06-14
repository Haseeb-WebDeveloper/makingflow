import { Skeleton } from "@/components/ui/skeleton"

/** Submissions-tab skeleton: search/filter bar + a table of response rows. */
export default function SubmissionsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-64 max-w-[60%] rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-11 w-full rounded-none" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-t border-border px-4 py-3.5">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
