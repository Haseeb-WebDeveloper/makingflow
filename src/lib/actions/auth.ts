'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { provisionUser } from '@/lib/auth/provisioning'
import { getRequiredUser } from '@/lib/auth/session'

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

/** Post-auth destination for an invite token, if a valid-looking one was passed. */
function inviteDestination(invite: FormDataEntryValue | null, fallback = DEFAULT_HOME): string {
  if (typeof invite !== 'string') return fallback
  const token = invite.trim()
  if (!token || !/^[a-zA-Z0-9]+$/.test(token)) return fallback
  return `/invite/${token}`
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

  // Provision here too, not only on signup and the OAuth callback.
  //
  // The Supabase auth row and the public.users row can exist independently: an
  // account made through the admin API never had a signup step, and
  // `signupAction` logs-and-continues if provisioning throws. Either way the
  // person authenticates successfully, `getSession` finds no users row, and
  // `getRequiredUser` redirects them back to the login page — forever, with no
  // error to explain it, because nothing actually failed. Idempotent by design
  // (see provisionUser), so returning users pass straight through.
  try {
    const meta = data.user.user_metadata ?? {}
    await provisionUser({
      userId: data.user.id,
      email: data.user.email ?? parsed.data.email,
      name:
        (meta.name as string | undefined) ??
        (meta.full_name as string | undefined) ??
        null,
      avatarUrl: (meta.avatar_url as string | undefined) ?? null,
    })
  } catch (err) {
    // Don't block a valid sign-in on this; getRequiredUser will bounce them if
    // the row truly never materialized, same as the callback does.
    console.error('[loginAction] provisioning failed', err)
  }

  // When the user came from an invite link, land them on the accept page.
  return { success: true, data: { redirectTo: inviteDestination(formData.get('invite')) } }
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

  // If they signed up from an invite, route post-confirmation to the accept page.
  const dest = inviteDestination(formData.get('invite'))

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name },
      emailRedirectTo: callbackUrl(dest),
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
  if (data.session) return { success: true, data: { redirectTo: dest, email: parsed.data.email } }
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

const ChangePasswordSchema = z.object({
  current: z.string().min(1, 'Enter your current password'),
  next: z.string().min(8, 'Use at least 8 characters'),
})

/**
 * Change the signed-in user's password.
 *
 * Distinct from `updatePassword`, which serves the reset-link flow and trusts
 * the recovery session the callback established. Here the session is an
 * ordinary one, so the CURRENT password is required and verified first:
 * without that, anyone who picked up a live session — a shared machine, a
 * borrowed laptop — could lock the real owner out of their own account.
 *
 * Verification is a real sign-in with the old password. Supabase has no
 * "check this password" call, and re-authenticating is what proves it; it
 * refreshes the same user's session, so the caller stays signed in either way.
 */
export async function changePassword(
  formData: FormData,
): Promise<ActionResult<Record<string, never>>> {
  const user = await getRequiredUser()

  const parsed = ChangePasswordSchema.safeParse({
    current: formData.get('current'),
    next: formData.get('next'),
  })
  if (!parsed.success) {
    return {
      success: false,
      error: 'Check the fields and try again.',
      fieldErrors: firstFieldErrors(parsed.error),
    }
  }
  if (parsed.data.current === parsed.data.next) {
    return { success: false, error: 'That is already your password.' }
  }

  const supabase = await createClient()
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.current,
  })
  if (authError) {
    // An account created through Google has no password to verify against, so
    // say what to do rather than insisting on one they never set.
    return {
      success: false,
      error:
        'That current password is not right. If you signed up with Google, use “Forgot password” to set one first.',
      fieldErrors: { current: 'Incorrect password' },
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.next })
  if (error) {
    return { success: false, error: error.message || 'Could not update your password.' }
  }

  // Revoke every OTHER session.
  //
  // Changing a password is usually a response to something — a shared laptop, a
  // borrowed phone, a suspicion. Leaving those sessions alive means the new
  // password protects nothing: whoever holds an old session keeps full access
  // and never has to know it changed. `scope: 'others'` drops them all and
  // leaves this one, so the person doing it is not signed out of the tab they
  // are standing in.
  //
  // After the change, not before: a failed update would otherwise sign the user
  // out of their other devices for nothing.
  const { error: revokeError } = await supabase.auth.signOut({ scope: 'others' })
  if (revokeError) {
    // The password DID change, so this is not a failure to report as one —
    // the account is already more secure than it was.
    console.error('[changePassword] could not revoke other sessions', revokeError)
  }

  return { success: true, data: {} }
}
