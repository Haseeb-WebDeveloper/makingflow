"use client"

import { useEffect } from "react"

/**
 * Error boundary for the public respondent runtime. A thrown error here (e.g.
 * outside getPublicForm's own catch, or in the renderer) must never show Next's
 * bare 500 to an anonymous respondent — degrade to a calm, branded message.
 */
export default function PublicFormError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Public form error:", error)
  }, [error])

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">
        This form isn&apos;t available right now
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Something went wrong loading this form. Please try again in a moment.
      </p>
      <button
        onClick={reset}
        className="mt-6 inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
      >
        Try again
      </button>
    </main>
  )
}
