"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { CreateWorkspaceDialog } from "@/components/dashboard/create-workspace-dialog"
import { useResetOnNavigate } from "@/lib/hooks/use-reset-on-navigate"

/** "New workspace" for the workspaces settings page — owns the dialog's state. */
export function CreateWorkspaceButton() {
  const [open, setOpen] = React.useState(false)
  // cacheComponents hides this page rather than unmounting it.
  useResetOnNavigate(() => setOpen(false))
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-4" />
        New workspace
      </Button>
      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
