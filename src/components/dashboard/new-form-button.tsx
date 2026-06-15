"use client"

import { SVGIcon } from "@/components/ui/svg-icon"
import { Loading } from "@/components/ui/loading"
import { cn } from "@/lib/utils"
import { useCreateForm } from "@/lib/forms/use-create-form"

/**
 * "New form" button. Creates an empty draft and navigates to its editor (see
 * useCreateForm). `className` fully styles the button so the same component
 * serves every variant (header, empty-state CTA, …); the leading plus icon
 * swaps to a spinner while the draft is being created.
 */
export function NewFormButton({
  className,
  iconClassName = "size-4",
  children = "New form",
  loading = false,
}: {
  className?: string
  iconClassName?: string
  children?: React.ReactNode
  /** Force the spinner/disabled state (e.g. the /sandbox preview). */
  loading?: boolean
}) {
  const { createForm, creating } = useCreateForm()
  const busy = creating || loading
  return (
    <button
      type="button"
      onClick={createForm}
      disabled={busy}
      aria-label="Create a new form"
      className={cn("disabled:opacity-70", className)}
    >
      {busy ? (
        <Loading fill className={cn("shrink-0", iconClassName)} />
      ) : (
        <SVGIcon src="/icons/plus.svg" className={iconClassName} />
      )}
      {children}
    </button>
  )
}
