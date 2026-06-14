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
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 lg:px-[1.667vw] text-center">
      <h1 className="text-lg lg:text-[1.25vw] font-semibold text-foreground">
        This form isn&apos;t available right now
      </h1>
      <p className="mt-1.5 lg:mt-[0.417vw] max-w-sm lg:max-w-[26.667vw] text-sm lg:text-[0.972vw] text-muted-foreground">
        Something went wrong loading this form. Please try again in a moment.
      </p>
      <button
        onClick={reset}
        className="mt-6 lg:mt-[1.667vw] inline-flex h-10 lg:h-[2.778vw] items-center rounded-md lg:rounded-[0.556vw] bg-foreground px-4 lg:px-[1.111vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
      >
        Try again
      </button>
    </main>
  )
}
