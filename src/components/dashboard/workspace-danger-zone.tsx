"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showToast } from "@/components/ui/toast"
import { useResetOnNavigate } from "@/lib/hooks/use-reset-on-navigate"
import { deleteWorkspace, leaveWorkspace } from "@/lib/actions/workspaces"

/**
 * The way out of a workspace: delete it if you own it, leave it if you don't.
 *
 * Which one you get is not a preference — an owner leaving would strand the
 * workspace without one, and a member deleting would take everyone else's work
 * with them. The blocked cases explain themselves rather than offering a button
 * that the server will refuse (it refuses regardless; the UI just shouldn't
 * pretend).
 */
export function WorkspaceDangerZone({
  workspaceId,
  name,
  isOwner,
  isSoleOwner,
  workspaceCount,
  formCount,
  submissionCount,
}: {
  workspaceId: string
  name: string
  isOwner: boolean
  isSoleOwner: boolean
  workspaceCount: number
  formCount: number
  submissionCount: number
}) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [leaveOpen, setLeaveOpen] = React.useState(false)
  const [confirmName, setConfirmName] = React.useState("")
  const [pending, start] = React.useTransition()

  // cacheComponents hides the page instead of unmounting it, so dialog state
  // would otherwise survive navigating away and back.
  useResetOnNavigate(() => {
    setDeleteOpen(false)
    setLeaveOpen(false)
  })

  const isLastWorkspace = workspaceCount <= 1

  function done(message: string) {
    showToast(message, { type: "success" })
    setDeleteOpen(false)
    setLeaveOpen(false)
    // This page describes a workspace that is gone, or no longer ours.
    router.push("/forms")
    router.refresh()
  }

  function confirmDelete() {
    start(async () => {
      const res = await deleteWorkspace(workspaceId, confirmName)
      if (res.success) done(`${name} was deleted`)
      else showToast(res.error, { type: "error" })
    })
  }

  function confirmLeave() {
    start(async () => {
      const res = await leaveWorkspace(workspaceId)
      if (res.success) done(`You left ${name}`)
      else showToast(res.error, { type: "error" })
    })
  }

  return (
    <section className="mt-8 rounded-lg border border-destructive/30 p-5">
      <h3 className="text-sm font-semibold text-foreground">Danger zone</h3>

      {isOwner ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Delete this workspace</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isLastWorkspace
                ? "You can't delete your only workspace. Create another one first."
                : "Its forms, responses, and uploaded files are erased permanently."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isLastWorkspace}
            onClick={() => {
              setConfirmName("")
              setDeleteOpen(true)
            }}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Delete workspace
          </Button>
        </div>
      ) : null}

      {/* An owner may leave only when someone else also owns it. */}
      {!isOwner || !isSoleOwner ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 first:mt-0 first:border-0 first:pt-0">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Leave this workspace</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isLastWorkspace
                ? "You can't leave your only workspace."
                : "You'll lose access until someone invites you back."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isLastWorkspace}
            onClick={() => setLeaveOpen(true)}
          >
            Leave workspace
          </Button>
        </div>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          You&apos;re the only owner, so you can&apos;t leave. Make someone else an owner
          first, or delete the workspace.
        </p>
      )}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!o && !pending) setDeleteOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This erases {formCount} {formCount === 1 ? "form" : "forms"}, {submissionCount}{" "}
              {submissionCount === 1 ? "response" : "responses"}, and every uploaded file in
              this workspace. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-workspace-name">
              Type <span className="font-semibold text-foreground">{name}</span> to confirm
            </Label>
            <Input
              id="confirm-workspace-name"
              value={confirmName}
              disabled={pending}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={pending || confirmName.trim() !== name}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {pending ? "Deleting…" : "Delete workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveOpen}
        onOpenChange={(o) => {
          if (!o && !pending) setLeaveOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll immediately lose access to its forms and responses. Nothing is
              deleted, and a member can invite you back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmLeave()
              }}
              disabled={pending}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {pending ? "Leaving…" : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
