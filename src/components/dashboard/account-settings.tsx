"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showToast } from "@/components/ui/toast"
import { updateProfile } from "@/lib/actions/profile"

function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function AccountSettings({
  user,
}: {
  user: { name: string; email: string; avatarUrl: string | null }
}) {
  const router = useRouter()
  const [name, setName] = useState(user.name)
  const [pending, start] = useTransition()
  const dirty = name.trim() !== user.name.trim()

  function save() {
    if (!dirty || !name.trim()) return
    start(async () => {
      const res = await updateProfile(name)
      if (res.success) {
        showToast("Profile updated", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-lg">
            {initials(user.name || user.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {user.name || "Your account"}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="account-name">Display name</Label>
          <Input
            id="account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            placeholder="Your name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && name.trim()) {
                e.preventDefault()
                save()
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" value={user.email} readOnly disabled className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Your email is managed through your sign-in method.
          </p>
        </div>
        <Button onClick={save} disabled={pending || !dirty || !name.trim()} className="h-9 px-4">
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}
