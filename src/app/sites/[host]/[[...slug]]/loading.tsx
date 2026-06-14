import { Skeleton } from "@/components/ui/skeleton"

/**
 * Respondent skeleton for forms served on a custom domain (same shape as the
 * /f/[publicId] runtime) so a cold load never flashes a blank canvas.
 */
export default function CustomDomainFormLoading() {
  return (
    <main className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto w-full max-w-2xl lg:max-w-[46.667vw] px-4 lg:px-[1.111vw] py-12 lg:py-[3.333vw] sm:px-6 sm:py-16">
        <Skeleton className="h-8 lg:h-[2.222vw] w-2/3" />
        <Skeleton className="mt-3 lg:mt-[0.833vw] h-4 lg:h-[1.111vw] w-1/2" />
        <div className="mt-10 lg:mt-[2.778vw] space-y-8 lg:space-y-[2.222vw]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2.5 lg:space-y-[0.694vw]">
              <Skeleton className="h-4 lg:h-[1.111vw] w-1/3" />
              <Skeleton className="h-11 lg:h-[3.056vw] w-full rounded-lg lg:rounded-[0.694vw]" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-10 lg:mt-[2.778vw] h-11 lg:h-[3.056vw] w-32 lg:w-[8.889vw] rounded-lg lg:rounded-[0.694vw]" />
      </div>
    </main>
  )
}
