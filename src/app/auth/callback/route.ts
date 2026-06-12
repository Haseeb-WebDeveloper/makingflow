import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { provisionUser } from '@/lib/auth/provisioning'

/**
 * Single PKCE callback for every email-based / OAuth flow: Google sign-in,
 * magic links, email confirmation, and password recovery. Exchanges the `code`
 * for a session, attaches the cookies to the redirect, and (idempotently)
 * provisions the account on first sign-in.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const errorDescription = url.searchParams.get('error_description')

  let next = url.searchParams.get('next') ?? '/forms'
  if (!next.startsWith('/') || next.startsWith('//')) next = '/forms'

  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/auth/login?error=callback`, request.url),
    )
  }
  if (!code) {
    return NextResponse.redirect(new URL('/auth/login?error=missing_code', request.url))
  }

  const response = NextResponse.redirect(new URL(next, request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/auth/login?error=callback', request.url))
  }

  // First sign-in via OAuth / magic link has no prior provisioning step. Run it
  // here (idempotent — returning users pass straight through).
  if (data.user) {
    const meta = data.user.user_metadata ?? {}
    const name =
      (meta.name as string | undefined) ??
      (meta.full_name as string | undefined) ??
      null
    const avatarUrl =
      (meta.avatar_url as string | undefined) ??
      (meta.picture as string | undefined) ??
      null
    try {
      await provisionUser({
        userId: data.user.id,
        email: data.user.email ?? '',
        name,
        avatarUrl,
      })
    } catch (err) {
      console.error('[auth/callback] provisioning failed', err)
      // Don't strand the user — they're authenticated. getRequiredUser will
      // bounce them if the row truly never materialized.
    }
  }

  return response
}
