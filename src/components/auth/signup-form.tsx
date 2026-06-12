"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { signupAction } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GoogleButton } from "@/components/auth/google-button"
import { AuthDivider, AuthError } from "@/components/auth/auth-shell"

type FieldErrors = Record<string, string>

export function SignupForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      const res = await signupAction(fd)
      if (!res.success) {
        setFormError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      if (res.data?.needsConfirmation) {
        router.push(
          `/auth/check-email?mode=confirm&email=${encodeURIComponent(res.data.email)}`,
        )
        return
      }
      router.push(res.data?.redirectTo ?? "/forms")
      router.refresh()
    })
  }

  return (
    <div>
      <GoogleButton next="/forms" label="Sign up with Google" />
      <AuthDivider label="or" />

      <AuthError message={formError} />

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="signup-name" className="text-sm font-medium text-foreground">
            Full name
          </Label>
          <Input
            id="signup-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Alex Rivera"
            required
            disabled={pending}
            className="h-11"
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? "signup-name-error" : undefined}
          />
          {fieldErrors.name && (
            <p id="signup-name-error" className="text-xs text-destructive">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-email" className="text-sm font-medium text-foreground">
            Email
          </Label>
          <Input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            disabled={pending}
            className="h-11"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
          />
          {fieldErrors.email && (
            <p id="signup-email-error" className="text-xs text-destructive">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-password" className="text-sm font-medium text-foreground">
            Password
          </Label>
          <Input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            minLength={8}
            disabled={pending}
            className="h-11"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
          />
          {fieldErrors.password && (
            <p id="signup-password-error" className="text-xs text-destructive">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <Button type="submit" disabled={pending} className="h-11 w-full text-sm font-medium">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        By continuing you agree to our{" "}
        <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  )
}
