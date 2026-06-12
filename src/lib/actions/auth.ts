'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { provisionUser } from '@/lib/auth/provisioning'

// ============================================================
// Types & helpers
// ============================================================

type FieldErrors = Record<string, string>

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: FieldErrors }

const DEFAULT_HOME = '/forms'

function getAppOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (site) return site
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`
  return 'http://localhost:3000'
}

/** Only allow same-app relative paths as a post-auth destination. */
function safeNext(next: string | null | undefined, fallback = DEFAULT_HOME): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback
  return next
}

function callbackUrl(next: string): string {
  return `${getAppOrigin()}/auth/callback?next=${encodeURIComponent(next)}`
}

function firstFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

// ============================================================
// Schemas
// ============================================================

const LoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

const SignupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters'),
})

const EmailSchema = z.object({ email: z.string().trim().email('Enter a valid email') })

const PasswordSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters'),
})

// ============================================================
// Email + password
// ============================================================

export async function loginAction(
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      success: false,
      error: 'Check your details and try again.',
      fieldErrors: firstFieldErrors(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error || !data.user) {
    // Don't leak which half was wrong.
    return { success: false, error: 'Wrong email or password.' }
  }

  return { success: true, data: { redirectTo: DEFAULT_HOME } }
}

export async function signupAction(
  formData: FormData,
): Promise<ActionResult<{ redirectTo?: string; needsConfirmation?: boolean; email: string }>> {
  const parsed = SignupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      success: false,
      error: 'Check your details and try again.',
      fieldErrors: firstFieldErrors(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name },
      emailRedirectTo: callbackUrl(DEFAULT_HOME),
    },
  })

  if (error || !data.user) {
    // Supabase returns a generic "User already registered" we can surface.
    return { success: false, error: error?.message || 'Could not create your account.' }
  }

  // Provision immediately so the account is whole even before email confirmation.
  // Idempotent — the callback re-runs it harmlessly on first sign-in.
  try {
    await provisionUser({
      userId: data.user.id,
      email: parsed.data.email,
      name: parsed.data.name,
    })
  } catch (err) {
    console.error('[signupAction] provisioning failed', err)
    return {
      success: false,
      error: 'Your account was created but setup failed. Please contact support.',
    }
  }

  // A session means email confirmation is OFF — go straight in. Otherwise the
  // user must confirm via the emailed link first.
  if (data.session) return { success: true, data: { redirectTo: DEFAULT_HOME, email: parsed.data.email } }
  return { success: true, data: { needsConfirmation: true, email: parsed.data.email } }
}

// ============================================================
// Magic link (passwordless — doubles as signup)
// ============================================================

export async function sendMagicLink(
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const parsed = EmailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { success: false, error: 'Enter a valid email.', fieldErrors: firstFieldErrors(parsed.error) }
  }
  const next = safeNext(formData.get('next') as string | null)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true, // passwordless signup for new emails
      emailRedirectTo: callbackUrl(next),
    },
  })

  if (error) {
    return { success: false, error: error.message || 'Could not send the magic link.' }
  }
  return { success: true, data: { email: parsed.data.email } }
}

// ============================================================
// Google OAuth
// ============================================================

export async function startGoogleOAuth(
  next?: string,
): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl(safeNext(next)),
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
  if (error || !data.url) {
    return { success: false, error: error?.message || 'Could not start Google sign-in.' }
  }
  return { success: true, data: { url: data.url } }
}

// ============================================================
// Password reset
// ============================================================

export async function requestPasswordReset(
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const parsed = EmailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { success: false, error: 'Enter a valid email.', fieldErrors: firstFieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  // The recovery link carries a PKCE code → callback exchanges it → lands the
  // (now briefly authenticated) user on the set-new-password page.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl('/auth/update-password'),
  })
  if (error) {
    return { success: false, error: error.message || 'Could not send the reset link.' }
  }
  return { success: true, data: { email: parsed.data.email } }
}

export async function updatePassword(
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = PasswordSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) {
    return { success: false, error: 'Use at least 8 characters.', fieldErrors: firstFieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  // Requires the recovery session established by the callback.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Your reset link expired. Request a new one.' }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { success: false, error: error.message || 'Could not update your password.' }
  }
  return { success: true, data: { redirectTo: DEFAULT_HOME } }
}

// ============================================================
// Sign out
// ============================================================

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
