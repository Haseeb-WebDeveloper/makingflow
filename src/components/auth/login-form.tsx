"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { loginAction, sendMagicLink } from "@/lib/actions/auth"
import { showToast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GoogleButton } from "@/components/auth/google-button"
import { PasswordInput } from "@/components/auth/password-input"
import { AuthDivider, AuthError } from "@/components/auth/auth-shell"

type Mode = "password" | "magic"
type FieldErrors = Record<string, string>

function safeRedirect(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/forms"
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = safeRedirect(searchParams.get("redirectTo"))

  const [mode, setMode] = useState<Mode>("password")
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pending, startTransition] = useTransition()
  const shownCallbackError = useRef(false)

  // Surface callback failures redirected here (?error=callback|missing_code).
  useEffect(() => {
    if (shownCallbackError.current) return
    const err = searchParams.get("error")
    if (err === "callback" || err === "missing_code") {
      shownCallbackError.current = true
      showToast("That sign-in link expired or was invalid. Try again.", { type: "error" })
    }
  }, [searchParams])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      if (mode === "magic") {
        fd.set("next", redirectTo)
        const res = await sendMagicLink(fd)
        if (!res.success) {
          setFormError(res.error)
          if (res.fieldErrors) setFieldErrors(res.fieldErrors)
          return
        }
        router.push(`/auth/check-email?mode=magic&email=${encodeURIComponent(res.data.email)}`)
        return
      }

      const res = await loginAction(fd)
      if (!res.success) {
        setFormError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      router.push(redirectTo)
      router.refresh()
    })
  }

  return (
    <div>
      <GoogleButton next={redirectTo} />
      <AuthDivider label="or" />

      <AuthError message={formError} />

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="login-email" className="text-sm font-medium text-foreground">
            Email
          </Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            disabled={pending}
            className="h-11"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
          />
          {fieldErrors.email && (
            <p id="login-email-error" className="text-xs text-destructive">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {mode === "password" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <Link
                href="/auth/forgot-password"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={pending ? -1 : 0}
              >
                Forgot?
              </Link>
            </div>
            <PasswordInput
              id="login-password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              disabled={pending}
              className="h-11"
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
            />
            {fieldErrors.password && (
              <p id="login-password-error" className="text-xs text-destructive">
                {fieldErrors.password}
              </p>
            )}
          </div>
        )}

        <Button type="submit" disabled={pending} className="h-11 w-full text-sm font-medium">
          {pending
            ? mode === "magic"
              ? "Sending…"
              : "Signing in…"
            : mode === "magic"
              ? "Send magic link"
              : "Sign in"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "password" ? "magic" : "password"))
          setFormError(null)
          setFieldErrors({})
        }}
        className="mt-4 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {mode === "password"
          ? "Email me a magic link instead"
          : "Sign in with a password instead"}
      </button>
    </div>
  )
}
