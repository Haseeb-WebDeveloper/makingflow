import { Skeleton } from "@/components/ui/skeleton"

/**
 * Respondent-facing skeleton for the public form runtime. Without this, a cold
 * load falls back to the root <Suspense fallback={null}> and shows a blank
 * canvas until the form query resolves over the network — the worst place in the
 * app to flash blank (anonymous, link-shared, often mobile).
 */
export default function PublicFormLoading() {
  return (
    <main className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto w-full max-w-2xl lg:max-w-[46.667vw] px-4 lg:px-[1.111vw] py-12 lg:py-[3.333vw] sm:px-6 sm:py-16">
        {/* Title + intro */}
        <Skeleton className="h-8 lg:h-[2.222vw] w-2/3" />
        <Skeleton className="mt-3 lg:mt-[0.833vw] h-4 lg:h-[1.111vw] w-1/2" />

        {/* A few question blocks */}
        <div className="mt-10 lg:mt-[2.778vw] space-y-8 lg:space-y-[2.222vw]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2.5 lg:space-y-[0.694vw]">
              <Skeleton className="h-4 lg:h-[1.111vw] w-1/3" />
              <Skeleton className="h-11 lg:h-[3.056vw] w-full rounded-lg lg:rounded-[0.694vw]" />
            </div>
          ))}
        </div>

        {/* Submit */}
        <Skeleton className="mt-10 lg:mt-[2.778vw] h-11 lg:h-[3.056vw] w-32 lg:w-[8.889vw] rounded-lg lg:rounded-[0.694vw]" />
      </div>
    </main>
  )
}
