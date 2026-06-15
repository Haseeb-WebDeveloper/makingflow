"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { showToast } from "@/components/ui/toast"
import { InviteDialog } from "@/components/dashboard/invite-dialog"
import {
  changeMemberRole,
  removeMember,
  revokeInvitation,
  resendInvitation,
} from "@/lib/actions/team"
import type { TeamMember, PendingInvite } from "@/lib/data/team"

function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function TeamManager({
  members,
  invitations,
  currentUserId,
  isOwner,
}: {
  members: TeamMember[]
  invitations: PendingInvite[]
  currentUserId: string
  isOwner: boolean
}) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [pending, start] = useTransition()
  const ownerCount = members.filter((m) => m.role === "owner").length

  function onRoleChange(userId: string, role: string) {
    start(async () => {
      const res = await changeMemberRole(userId, role)
      if (res.success) {
        showToast("Role updated", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function confirmRemove() {
    const target = removeTarget
    if (!target) return
    start(async () => {
      const res = await removeMember(target.userId)
      if (res.success) {
        showToast("Member removed", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
      setRemoveTarget(null)
    })
  }

  function onRevoke(id: string) {
    start(async () => {
      const res = await revokeInvitation(id)
      if (res.success) {
        showToast("Invitation revoked", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function onResend(id: string) {
    start(async () => {
      const res = await resendInvitation(id)
      if (res.success) {
        void navigator.clipboard.writeText(res.inviteLink)
        showToast(res.emailed ? "Invite re-sent — link copied" : "Invite link copied", {
          type: "success",
        })
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <div className="mt-8 space-y-10">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Members <span className="text-muted-foreground">({members.length})</span>
          </h2>
          {isOwner ? (
            <Button onClick={() => setInviteOpen(true)} className="h-9 px-3">
              Invite member
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Member</TableHead>
                <TableHead className="w-40">Role</TableHead>
                {isOwner ? (
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = m.userId === currentUserId
                // Don't let the last owner be demoted (server enforces too).
                const lockRole = m.role === "owner" && ownerCount <= 1
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                          <AvatarFallback>{initials(m.name || m.email)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {m.name || m.email}
                            {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => onRoleChange(m.userId, v)}
                          disabled={pending || lockRole}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                          {m.role}
                        </Badge>
                      )}
                    </TableCell>
                    {isOwner ? (
                      <TableCell className="text-right">
                        {!isSelf ? (
                          <Button
                            variant="ghost"
                            onClick={() => setRemoveTarget(m)}
                            disabled={pending}
                            className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            Remove
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {isOwner && invitations.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Pending invitations <span className="text-muted-foreground">({invitations.length})</span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Email</TableHead>
                  <TableHead className="w-28">Role</TableHead>
                  <TableHead className="w-40 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm text-foreground">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inv.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        onClick={() => onResend(inv.id)}
                        disabled={pending}
                        className="h-8 px-2"
                      >
                        Copy link
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => onRevoke(inv.id)}
                        disabled={pending}
                        className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(o) => {
          if (!o && !pending) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.name || removeTarget?.email} will immediately lose access to this
              workspace. This can&apos;t be undone (they can be re-invited).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmRemove()
              }}
              disabled={pending}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {pending ? "Removing…" : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
