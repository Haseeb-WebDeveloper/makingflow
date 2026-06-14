import { cache } from 'react'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { users, workspaceMembers, workspaces } from '@/lib/db/schema'

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
 * query that joins the user row to their default workspace membership. Collapses
 * what used to be two serial remote round-trips (user, then workspace) into one.
 *
 * We trust only `sub` from the token; everything authorization-relevant
 * (membership, role, plan) comes from our own tables. v1 ships one workspace per
 * user, so limit(1) is the default tenant.
 */
const getSession = cache(
  async (): Promise<{
    user: typeof users.$inferSelect
    workspace: WorkspaceContext | null
  } | null> => {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.auth.getClaims()
      const userId = data?.claims?.sub
      if (error || !userId) return null

      const [row] = await db
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
        .limit(1)
      if (!row) return null

      const workspace: WorkspaceContext | null =
        row.workspace.id == null
          ? null
          : {
              id: row.workspace.id,
              name: row.workspace.name!,
              slug: row.workspace.slug!,
              plan: row.workspace.plan!,
              role: row.workspace.role!,
            }
      return { user: row.user, workspace }
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
