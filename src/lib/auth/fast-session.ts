/**
 * Fast-path session for hot-path Server Actions (autosave, submit, etc).
 *
 * `supabase.auth.getClaims()` verifies the JWT LOCALLY against the cached JWKS
 * when the project uses asymmetric keys (ES256/RS256) — no network round-trip
 * to Supabase Auth, shaving ~150-250ms per call vs getUser(). Pages/layouts
 * should still use getRequiredUser() (they need the full user row).
 *
 * We trust only `sub` (the user id) from the token. Anything authorization-
 * relevant (workspace membership, role) is mutable on our own tables and must
 * be queried — never read from the JWT.
 */
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type FastSession = { userId: string }

/** cache() dedupes per request so one render pays a single verification. */
export const getFastSession = cache(async (): Promise<FastSession | null> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getClaims()
    if (error || !data?.claims?.sub) return null
    return { userId: data.claims.sub }
  } catch {
    return null
  }
})

export class UnauthenticatedError extends Error {
  constructor() {
    super('UNAUTHENTICATED')
    this.name = 'UnauthenticatedError'
  }
}

/** Strict variant — throws so an action can branch into a 401-style response. */
export async function requireFastSession(): Promise<FastSession> {
  const s = await getFastSession()
  if (!s) throw new UnauthenticatedError()
  return s
}
