// Full-height centered spinner for route-level loading.tsx fallbacks on
// standalone (non-dashboard) pages — the get-a-quote / onboarding / invite flows.
export function PageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <span
        aria-hidden="true"
        className="size-6 lg:size-[1.667vw] animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70"
      />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
