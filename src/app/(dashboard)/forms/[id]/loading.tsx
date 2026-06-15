import { Skeleton } from "@/components/ui/skeleton"

/**
 * Full form-detail skeleton — shown the moment you open a form, while the
 * management layout itself (title, tabs, publish button) resolves its data.
 * Without this, that layout blocks with a blank screen before the per-tab
 * skeleton can appear. Mirrors the layout chrome so the swap to real content
 * doesn't jump.
 */
export default function FormDetailLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header chrome (title + status + actions, then the tab strip) */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-7xl px-6 pt-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="h-9 w-20 rounded-md" />
              <Skeleton className="h-9 w-16 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 pb-2.5">
            {["w-16", "w-24", "w-20", "w-16"].map((w, i) => (
              <Skeleton key={i} className={`h-5 ${w}`} />
            ))}
          </div>
        </div>
      </div>

      {/* Content (matches the default Insights tab) */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 sm:px-8">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 w-full rounded-lg" />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
