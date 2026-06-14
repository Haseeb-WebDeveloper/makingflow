import { Skeleton } from "@/components/ui/skeleton"

/**
 * Content skeleton for a form's management tabs (insights / submissions /
 * integrations / settings). The header + tab bar come from the layout; this
 * fills the content area while the tab's data loads. Per-tab skeletons can
 * refine this further later.
 */
export default function FormManageLoading() {
  return (
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
  )
}
