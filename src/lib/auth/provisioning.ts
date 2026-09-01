// Server-only: provisions a brand-new account's scaffolding.
//
// Called from TWO places, so it MUST be idempotent:
//   - the email/password signup action (src/lib/actions/auth.ts)
//   - the auth callback (src/app/auth/callback/route.ts) for Google OAuth and
//     magic-link first sign-in, where no pre-signup step ran.
//
// Creates: the public.users row, one workspace, and the owner membership.
// v1 ships single-member workspaces; teams/invitations land later without a
// schema change (see src/lib/db/schema.ts).

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, workspaceMembers, workspaces } from '@/lib/db/schema'
import { withSlugRetry } from '@/lib/workspaces/slug'

function deriveWorkspaceName(name: string | null, email: string): string {
  const base = (name?.trim() || email.split('@')[0] || 'My').trim()
  const first = base.split(/\s+/)[0]
  return `${first}'s workspace`
}

export async function provisionUser({
  userId,
  email,
  name,
  avatarUrl = null,
}: {
  userId: string
  email: string
  name: string | null
  avatarUrl?: string | null
}): Promise<void> {
  // Upsert the public.users row (id = Supabase auth uid). On a repeat call we
  // refresh email/name/avatar but never clobber with nulls.
  await db
    .insert(users)
    .values({ id: userId, email, name, avatarUrl })
    .onConflictDoUpdate({
      target: users.id,
      set: { email, ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) },
    })

  // Already a member of a workspace? Then this account is fully provisioned.
  const [existing] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1)
  if (existing) return

  const workspaceName = deriveWorkspaceName(name, email)

  // Short random suffix avoids a uniqueness round-trip on the slug index; the
  // retry covers the rare case where it collides anyway (signup must not 500).
  await withSlugRetry(workspaceName, (slug) =>
    db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: workspaceName, slug, createdById: userId })
        .returning({ id: workspaces.id })

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId,
        role: 'owner',
      })
    }),
  )
}
