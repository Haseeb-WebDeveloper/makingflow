import { Skeleton } from "@/components/ui/skeleton"

/** Settings-tab skeleton: a few labelled setting sections. */
export default function FormSettingsLoading() {
  return (
    <div className="max-w-2xl space-y-8">
      {Array.from({ length: 3 }).map((_, s) => (
        <div key={s}>
          <Skeleton className="mb-2 h-4 w-32" />
          <div className="rounded-lg border border-border px-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
                <Skeleton className="h-6 w-10 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
