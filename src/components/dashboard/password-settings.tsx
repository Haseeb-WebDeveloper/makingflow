"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { Label } from "@/components/ui/label"
import { showToast } from "@/components/ui/toast"
import { changePassword } from "@/lib/actions/auth"

/**
 * Change your own password from account settings.
 *
 * Collapsed until asked for: most visits here are to edit a display name, and
 * three password fields sitting open is a form nobody wanted.
 */
export function PasswordSettings() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function reset() {
    setCurrent("")
    setNext("")
    setConfirm("")
    setError(null)
  }

  // Checked here as well as on the server: this one is only about catching a
  // typo before it costs a round trip, since the two fields exist for exactly
  // that reason.
  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !pending

  function save() {
    if (!canSubmit) return
    setError(null)
    start(async () => {
      const body = new FormData()
      body.set("current", current)
      body.set("next", next)
      const res = await changePassword(body)
      if (res.success) {
        showToast("Password updated — signed out on other devices", {
          type: "success",
          duration: 6000,
        })
        setOpen(false)
        reset()
      } else {
        setError(res.error)
      }
    })
  }

  if (!open) {
    return (
      <div className="max-w-md">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Change password
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">Current password</Label>
        <PasswordInput
          id="pw-current"
          autoComplete="current-password"
          value={current}
          disabled={pending}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-next">New password</Label>
        <PasswordInput
          id="pw-next"
          autoComplete="new-password"
          value={next}
          disabled={pending}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">Confirm new password</Label>
        <PasswordInput
          id="pw-confirm"
          autoComplete="new-password"
          value={confirm}
          disabled={pending}
          aria-invalid={mismatch || undefined}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) {
              e.preventDefault()
              save()
            }
          }}
        />
        {mismatch ? (
          <p className="text-xs text-destructive">Those don&apos;t match.</p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={save} disabled={!canSubmit}>
          {pending ? "Updating…" : "Update password"}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            reset()
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
