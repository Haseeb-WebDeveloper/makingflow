import { Skeleton } from "@/components/ui/skeleton"

/**
 * Respondent skeleton for forms served on a custom domain (same shape as the
 * /f/[publicId] runtime) so a cold load never flashes a blank canvas.
 */
export default function CustomDomainFormLoading() {
  return (
    <main className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <div className="mt-10 space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-10 h-11 w-32 rounded-lg" />
      </div>
    </main>
  )
}
