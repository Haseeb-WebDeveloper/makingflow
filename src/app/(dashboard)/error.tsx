"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"

/**
 * Error boundary for the whole dashboard. Catches throws from any dashboard
 * page/data fetch so a transient DB blip shows a recoverable screen instead of
 * Next's bare 500. `reset()` re-renders the segment (re-runs the failed fetch).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard error:", error)
  }, [error])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-center px-6 py-24 text-center sm:px-8">
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <Icon name="info-square" className="size-6" />
      </span>
      <h1 className="font-sebenta text-xl font-bold tracking-tight text-foreground">
        Something went wrong
      </h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        We couldn&apos;t load this page. This is usually temporary — try again in a
        moment.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button onClick={reset} className="h-9 px-4">
          Try again
        </Button>
        <Button asChild variant="outline" className="h-9 px-4">
          <Link href="/forms">Go home</Link>
        </Button>
      </div>
    </div>
  )
}
