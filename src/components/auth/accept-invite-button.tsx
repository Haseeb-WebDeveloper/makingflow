"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { acceptInvitation } from "@/lib/actions/team"
import { Button } from "@/components/ui/button"
import { showToast } from "@/components/ui/toast"

/** Accept the invitation as the signed-in user, then enter the joined workspace. */
export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function accept() {
    start(async () => {
      const res = await acceptInvitation(token)
      if (res.success) {
        showToast("You've joined the workspace", { type: "success" })
        router.push("/forms")
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <Button onClick={accept} disabled={pending} className="h-11 w-full text-sm font-medium">
      {pending ? "Joining…" : "Accept invitation"}
    </Button>
  )
}
