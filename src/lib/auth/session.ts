import { cache } from 'react'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { users, workspaceMembers, workspaces } from '@/lib/db/schema'

/**
 * React cache() deduplicates this across the whole render tree — the protected
 * layout calls it, the page calls it, but only ONE verification + one DB query
 * runs per request. This is the canonical auth read for pages/layouts.
 *
 * Uses getClaims() (local JWT verification against the cached JWKS) instead of
 * getUser() (a network round-trip to Supabase Auth) — saving ~150-250ms on every
 * authenticated request. We trust only `sub` from the token; the full user row
 * still comes from our DB. Same trust model as the fast-path session helper.
 */
const getAuthUser = cache(async () => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getClaims()
    const userId = data?.claims?.sub
    if (error || !userId) return null

    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return dbUser ?? null
  } catch {
    // Auth/DB unreachable — treat as unauthenticated rather than 500 the page.
    return null
  }
})

/** Use in protected layouts/pages. Redirects to login on failure — never null. */
export async function getRequiredUser() {
  const dbUser = await getAuthUser()
  if (!dbUser) redirect('/auth/login')
  return dbUser
}

/** For public pages that render differently when signed in. Never redirects. */
export async function getOptionalUser() {
  try {
    return await getAuthUser()
  } catch {
    return null
  }
}

/**
 * The caller's default workspace (v1 ships one workspace per user). Cached per
 * request. Redirects to login if unauthenticated. Used by the dashboard shell
 * to resolve the active tenant.
 */
export const getDefaultWorkspace = cache(async () => {
  const user = await getRequiredUser()
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      plan: workspaces.plan,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1)

  return row ?? null
})
