import { cache } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { asc, eq, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { users, workspaceMembers, workspaces } from '@/lib/db/schema'

/** Cookie holding the user's active workspace id (set by switchWorkspace / accept). */
export const ACTIVE_WORKSPACE_COOKIE = 'mf_ws'

type WorkspaceContext = {
  id: string
  name: string
  slug: string
  plan: string
  role: string
}

/**
 * The single auth+tenant read, cached per request. One local JWT verification
 * (getClaims — no network round-trip to Supabase Auth, vs getUser) plus ONE DB
 * query that joins the user row to ALL of their workspace memberships.
 *
 * We trust only `sub` from the token; everything authorization-relevant
 * (membership, role, plan) comes from our own tables. A user may belong to
 * several workspaces (their own + any they're invited to); the ACTIVE one is
 * chosen from the `mf_ws` cookie when it names a workspace they actually belong
 * to, otherwise the deterministic default (owner-first, then earliest joined).
 *
 * NOTE: reads cookies(), so this stays a per-request React cache() — never wrap
 * it in `"use cache"` (a cached function can't read request cookies).
 */
const getSession = cache(
  async (): Promise<{
    user: typeof users.$inferSelect
    workspaces: WorkspaceContext[]
    workspace: WorkspaceContext | null
  } | null> => {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.auth.getClaims()
      const userId = data?.claims?.sub
      if (error || !userId) return null

      const rows = await db
        .select({
          user: users,
          workspace: {
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
            plan: workspaces.plan,
            role: workspaceMembers.role,
          },
        })
        .from(users)
        .leftJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
        .leftJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(users.id, userId))
        // Deterministic default ordering: owners first, then earliest joined.
        .orderBy(
          sql`case when ${workspaceMembers.role} = 'owner' then 0 else 1 end`,
          asc(workspaceMembers.createdAt),
        )
      if (rows.length === 0) return null

      const user = rows[0].user
      const list: WorkspaceContext[] = rows
        .filter((r) => r.workspace.id != null)
        .map((r) => ({
          id: r.workspace.id!,
          name: r.workspace.name!,
          slug: r.workspace.slug!,
          plan: r.workspace.plan!,
          role: r.workspace.role!,
        }))

      // Active workspace: the cookie's choice if the user is a member of it
      // (the find over their OWN rows is the membership check — a stale or
      // forged cookie simply falls back to the default at index 0).
      const cookieStore = await cookies()
      const preferred = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value
      const workspace =
        (preferred ? list.find((w) => w.id === preferred) : undefined) ?? list[0] ?? null

      return { user, workspaces: list, workspace }
    } catch {
      // Auth/DB unreachable — treat as unauthenticated rather than 500 the page.
      return null
    }
  },
)

/** Use in protected layouts/pages. Redirects to login on failure — never null. */
export async function getRequiredUser() {
  const session = await getSession()
  if (!session) redirect('/auth/login')
  return session.user
}

/** For public pages that render differently when signed in. Never redirects. */
export async function getOptionalUser() {
  return (await getSession())?.user ?? null
}

/**
 * The caller's default workspace (v1 ships one workspace per user). Resolved in
 * the same cached query as the user — no extra round-trip. Returns null if the
 * caller has no workspace (or isn't authenticated); the auth boundary
 * (getRequiredUser in the dashboard layout) handles the redirect.
 */
export const getDefaultWorkspace = cache(async () => (await getSession())?.workspace ?? null)

/** All workspaces the caller belongs to (for the sidebar switcher). Derived from
 *  the same cached session read — no extra query. */
export const getMyWorkspaces = cache(async () => (await getSession())?.workspaces ?? [])
