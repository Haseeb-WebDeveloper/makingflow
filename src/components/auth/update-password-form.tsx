"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updatePassword } from "@/lib/actions/auth"
import { showToast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthError } from "@/components/auth/auth-shell"

type FieldErrors = Record<string, string>

export function UpdatePasswordForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    const form = e.currentTarget
    const fd = new FormData(form)

    const password = String(fd.get("password") ?? "")
    const confirm = String(fd.get("confirm") ?? "")
    if (password !== confirm) {
      setFieldErrors({ confirm: "Passwords don't match" })
      return
    }

    startTransition(async () => {
      const res = await updatePassword(fd)
      if (!res.success) {
        setFormError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      showToast("Password updated.", { type: "success" })
      router.push(res.data.redirectTo)
      router.refresh()
    })
  }

  return (
    <div>
      <AuthError message={formError} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-sm font-medium text-foreground">
            New password
          </Label>
          <Input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            minLength={8}
            disabled={pending}
            className="h-11"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "new-password-error" : undefined}
          />
          {fieldErrors.password && (
            <p id="new-password-error" className="text-xs text-destructive">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
            Confirm password
          </Label>
          <Input
            id="confirm-password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            disabled={pending}
            className="h-11"
            aria-invalid={!!fieldErrors.confirm}
            aria-describedby={fieldErrors.confirm ? "confirm-password-error" : undefined}
          />
          {fieldErrors.confirm && (
            <p id="confirm-password-error" className="text-xs text-destructive">
              {fieldErrors.confirm}
            </p>
          )}
        </div>

        <Button type="submit" disabled={pending} className="h-11 w-full text-sm font-medium">
          {pending ? "Saving…" : "Update password"}
        </Button>
      </form>
    </div>
  )
}
