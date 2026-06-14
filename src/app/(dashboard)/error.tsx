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
    <div className="mx-auto flex w-full max-w-6xl lg:max-w-[80vw] flex-col items-center justify-center px-6 lg:px-[1.667vw] py-24 lg:py-[6.667vw] text-center sm:px-8">
      <span className="mb-4 lg:mb-[1.111vw] flex size-12 lg:size-[3.333vw] items-center justify-center rounded-xl lg:rounded-[0.926vw] bg-destructive/10 text-destructive">
        <Icon name="info-square" className="size-6 lg:size-[1.667vw]" />
      </span>
      <h1 className="font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground">
        Something went wrong
      </h1>
      <p className="mt-1.5 lg:mt-[0.417vw] max-w-md lg:max-w-[31.111vw] text-sm lg:text-[0.972vw] text-muted-foreground">
        We couldn&apos;t load this page. This is usually temporary — try again in a
        moment.
      </p>
      <div className="mt-6 lg:mt-[1.667vw] flex items-center gap-2 lg:gap-[0.556vw]">
        <Button onClick={reset} className="h-9 lg:h-[2.5vw] px-4 lg:px-[1.111vw]">
          Try again
        </Button>
        <Button asChild variant="outline" className="h-9 lg:h-[2.5vw] px-4 lg:px-[1.111vw]">
          <Link href="/forms">Go home</Link>
        </Button>
      </div>
    </div>
  )
}
