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
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        {/* Title + intro */}
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />

        {/* A few question blocks */}
        <div className="mt-10 space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>

        {/* Submit */}
        <Skeleton className="mt-10 h-11 w-32 rounded-lg" />
      </div>
    </main>
  )
}
