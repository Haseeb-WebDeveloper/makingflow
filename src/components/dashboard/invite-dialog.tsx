"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showToast } from "@/components/ui/toast"
import { inviteMember } from "@/lib/actions/team"

export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("member")
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null)
  const [pending, start] = useTransition()

  function reset() {
    setEmail("")
    setRole("member")
    setResult(null)
  }

  function submit() {
    if (!email.trim()) return
    start(async () => {
      const res = await inviteMember(email, role)
      if (res.success) {
        setResult({ link: res.inviteLink, emailed: res.emailed })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function copyLink() {
    if (!result) return
    void navigator.clipboard.writeText(result.link)
    showToast("Invite link copied", { type: "success" })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They&apos;ll get access to this workspace&apos;s forms and submissions.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {result.emailed
                ? "Invitation sent. You can also share this link:"
                : "Email isn't configured — share this invite link directly:"}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.link} className="h-9 flex-1 text-xs" />
              <Button type="button" variant="outline" onClick={copyLink} className="h-9 shrink-0 px-3">
                Copy
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.trim()) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={setRole} disabled={pending}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member with full form & submission access</SelectItem>
                  <SelectItem value="owner">Owner with full access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending || !email.trim()}>
                {pending ? "Sending…" : "Send invite"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
