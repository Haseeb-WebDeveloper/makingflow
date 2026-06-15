"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { createDraftForm } from "@/lib/actions/forms"
import { showToast } from "@/components/ui/toast"

/**
 * Create-then-edit: make an empty draft form, then go straight to its editor.
 * "New form" everywhere uses this so the URL is the form's own from the first
 * second (full publish dialog, working header button) and there's no reload
 * after the AI builds. `creating` reflects the in-flight create + navigation
 * (via an async transition) so callers can show a spinner / disable the button.
 */
export function useCreateForm() {
  const router = useRouter()
  const [creating, startTransition] = useTransition()

  function createForm() {
    if (creating) return
    startTransition(async () => {
      try {
        const { id } = await createDraftForm()
        router.push(`/forms/${id}/edit`)
      } catch {
        showToast("Couldn't create a new form. Please try again.", { type: "error" })
      }
    })
  }

  return { createForm, creating }
}
