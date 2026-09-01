"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showToast } from "@/components/ui/toast"
import { createWorkspace } from "@/lib/actions/workspaces"

/**
 * Create a workspace.
 *
 * Controlled by the parent so it can be opened from the account menu (where the
 * dropdown unmounts on select and would take an inlined dialog with it) as well
 * as from the workspaces settings page.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [pending, start] = React.useTransition()

  // Note: closing on navigation is the OWNER's job (see useResetOnNavigate in
  // user-nav / create-workspace-button) — `open` is their state, and resetting a
  // parent's state from here would be a render-phase update of another component.

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    start(async () => {
      const res = await createWorkspace(trimmed)
      if (res.success) {
        showToast(`${trimmed} is ready`, { type: "success" })
        onOpenChange(false)
        setName("")
        // The new workspace is now active, and it has no forms yet.
        router.push("/forms")
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("")
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            A separate space with its own forms, responses, and members. Nothing is shared
            with your other workspaces.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="new-workspace-name">Name</Label>
          <Input
            id="new-workspace-name"
            autoFocus
            value={name}
            maxLength={60}
            disabled={pending}
            placeholder="Acme Inc"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
