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
        <div className="mx-auto w-full max-w-6xl lg:max-w-[80vw] px-6 lg:px-[1.667vw] pt-6 lg:pt-[1.667vw] sm:px-8">
          <div className="flex items-start justify-between gap-4 lg:gap-[1.111vw]">
            <div className="flex items-center gap-2.5 lg:gap-[0.694vw]">
              <Skeleton className="h-6 lg:h-[1.667vw] w-48 lg:w-[13.333vw]" />
              <Skeleton className="h-5 lg:h-[1.389vw] w-16 lg:w-[4.444vw] rounded-full" />
            </div>
            <div className="flex shrink-0 items-center gap-2 lg:gap-[0.556vw]">
              <Skeleton className="h-9 lg:h-[2.5vw] w-20 lg:w-[5.556vw] rounded-md lg:rounded-[0.556vw]" />
              <Skeleton className="h-9 lg:h-[2.5vw] w-16 lg:w-[4.444vw] rounded-md lg:rounded-[0.556vw]" />
              <Skeleton className="h-9 lg:h-[2.5vw] w-24 lg:w-[6.667vw] rounded-md lg:rounded-[0.556vw]" />
            </div>
          </div>
          <div className="mt-4 lg:mt-[1.111vw] flex items-center gap-4 lg:gap-[1.111vw] pb-2.5 lg:pb-[0.694vw]">
            {["w-16 lg:w-[4.444vw]", "w-24", "w-20", "w-16"].map((w, i) => (
              <Skeleton key={i} className={`h-5 lg:h-[1.389vw] ${w}`} />
            ))}
          </div>
        </div>
      </div>

      {/* Content (matches the default Insights tab) */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl lg:max-w-[80vw] flex-1 px-6 lg:px-[1.667vw] py-8 lg:py-[2.222vw] sm:px-8">
          <div className="space-y-3 lg:space-y-[0.833vw]">
            <div className="grid grid-cols-2 gap-3 lg:gap-[0.833vw] lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] lg:h-[7.222vw] w-full rounded-lg lg:rounded-[0.694vw]" />
              ))}
            </div>
            <Skeleton className="h-64 lg:h-[17.778vw] w-full rounded-lg lg:rounded-[0.694vw]" />
            <div className="grid grid-cols-1 gap-3 lg:gap-[0.833vw] lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44 lg:h-[12.222vw] w-full rounded-lg lg:rounded-[0.694vw]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
