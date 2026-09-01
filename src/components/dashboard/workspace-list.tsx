"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showToast } from "@/components/ui/toast"
import { useResetOnNavigate } from "@/lib/hooks/use-reset-on-navigate"
import { WorkspaceAvatar } from "@/components/dashboard/workspace-avatar"
import { deleteWorkspace, leaveWorkspace, switchWorkspace } from "@/lib/actions/workspaces"

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
}

export type WorkspaceRow = {
  id: string
  name: string
  slug: string
  plan: string
  role: string
  logoUrl: string | null
}

export function WorkspaceList({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceRow[]
  activeId: string | null
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [deleteTarget, setDeleteTarget] = React.useState<WorkspaceRow | null>(null)
  const [leaveTarget, setLeaveTarget] = React.useState<WorkspaceRow | null>(null)
  const [confirmName, setConfirmName] = React.useState("")

  // cacheComponents hides this page rather than unmounting it, so a dialog left
  // open would still be open when the user navigates back.
  useResetOnNavigate(() => {
    setDeleteTarget(null)
    setLeaveTarget(null)
  })

  // The last workspace can be neither left nor deleted — it would leave the
  // account with nowhere to go. The server enforces this too.
  const isLast = workspaces.length <= 1

  function switchAndManage(id: string) {
    start(async () => {
      const res = await switchWorkspace(id)
      if (res.success) {
        router.push("/settings/workspace")
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function confirmDelete() {
    const target = deleteTarget
    if (!target) return
    start(async () => {
      const res = await deleteWorkspace(target.id, confirmName)
      if (res.success) {
        showToast(`${target.name} was deleted`, { type: "success" })
        setDeleteTarget(null)
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function confirmLeave() {
    const target = leaveTarget
    if (!target) return
    start(async () => {
      const res = await leaveWorkspace(target.id)
      if (res.success) {
        showToast(`You left ${target.name}`, { type: "success" })
        setLeaveTarget(null)
        router.refresh()
      } else {
        // Covers the sole-owner refusal, which a row can't predict without a
        // per-workspace owner count.
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Workspace</TableHead>
            <TableHead className="w-28">Plan</TableHead>
            <TableHead className="w-28">Role</TableHead>
            <TableHead className="w-36 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workspaces.map((w) => {
            const isActive = w.id === activeId
            return (
              <TableRow key={w.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <WorkspaceAvatar name={w.name} logoUrl={w.logoUrl} size="md" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                        {w.name}
                        {isActive ? (
                          <Badge variant="secondary" className="font-normal">
                            Active
                          </Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">/{w.slug}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {PLAN_LABEL[w.plan] ?? w.plan}
                </TableCell>
                <TableCell>
                  <Badge variant={w.role === "owner" ? "default" : "secondary"}>{w.role}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isActive ? (
                      <Button asChild variant="ghost" className="h-8 px-3">
                        <Link href="/settings/workspace">Manage</Link>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => switchAndManage(w.id)}
                        disabled={pending}
                        className="h-8 px-3"
                      >
                        Switch
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="size-8 p-0"
                          aria-label={`Actions for ${w.name}`}
                        >
                          <Icon name="more-circle" className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {!isActive ? (
                          <>
                            <DropdownMenuItem onSelect={() => switchAndManage(w.id)}>
                              <Icon name="swap" className="size-4 text-muted-foreground" />
                              Switch to this
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        ) : null}
                        {w.role === "owner" ? (
                          <DropdownMenuItem
                            disabled={isLast}
                            onSelect={(e) => {
                              // Keep the menu's close from racing the dialog's open.
                              e.preventDefault()
                              setConfirmName("")
                              setDeleteTarget(w)
                            }}
                          >
                            <Icon name="delete" className="size-4 text-destructive" />
                            Delete workspace
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={isLast}
                            onSelect={(e) => {
                              e.preventDefault()
                              setLeaveTarget(w)
                            }}
                          >
                            <Icon name="delete" className="size-4 text-destructive" />
                            Leave workspace
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o && !pending) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every form, response, and uploaded file in this workspace is erased
              permanently. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-workspace-name-row">
              Type <span className="font-semibold text-foreground">{deleteTarget?.name}</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-workspace-name-row"
              value={confirmName}
              disabled={pending}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
              className="bg-card"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={pending || confirmName.trim() !== deleteTarget?.name}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {pending ? "Deleting…" : "Delete workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveTarget !== null}
        onOpenChange={(o) => {
          if (!o && !pending) setLeaveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {leaveTarget?.name}?</AlertDialogTitle>
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
    </div>
  )
}
