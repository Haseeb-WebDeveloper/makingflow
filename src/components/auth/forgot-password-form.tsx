"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { requestPasswordReset } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthError } from "@/components/auth/auth-shell"

type FieldErrors = Record<string, string>

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      const res = await requestPasswordReset(fd)
      if (!res.success) {
        setFormError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      setSentTo(res.data.email)
    })
  }

  if (sentTo) {
    return (
      <div className="space-y-5 lg:space-y-[1.389vw] text-center">
        <p className="text-sm lg:text-[0.972vw] text-muted-foreground">
          If an account exists for{" "}
          <span className="font-medium text-foreground">{sentTo}</span>, we&apos;ve
          sent a link to reset your password. Check your inbox.
        </p>
        <Link
          href="/auth/login"
          className="inline-flex h-11 lg:h-[3.056vw] w-full items-center justify-center rounded-md lg:rounded-[0.556vw] border border-border px-4 lg:px-[1.111vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div>
      <AuthError message={formError} />
      <form onSubmit={onSubmit} className="space-y-4 lg:space-y-[1.111vw]" noValidate>
        <div className="space-y-1.5 lg:space-y-[0.417vw]">
          <Label htmlFor="reset-email" className="text-sm lg:text-[0.972vw] font-medium text-foreground">
            Email
          </Label>
          <Input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            disabled={pending}
            className="h-11 lg:h-[3.056vw]"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "reset-email-error" : undefined}
          />
          {fieldErrors.email && (
            <p id="reset-email-error" className="text-xs lg:text-[0.833vw] text-destructive">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending} className="h-11 lg:h-[3.056vw] w-full text-sm lg:text-[0.972vw] font-medium">
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </div>
  )
}
