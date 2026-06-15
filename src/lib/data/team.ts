import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'

export type TeamMember = {
  userId: string
  name: string | null
  email: string
  avatarUrl: string | null
  role: string
  joinedAt: Date
}

export type PendingInvite = {
  id: string
  email: string
  role: string
  invitedAt: Date
  expiresAt: Date
}

/** Members + pending invitations for a workspace. Caller must already have
 *  resolved (and tenancy-checked) the workspace via the session. */
export async function getTeam(
  workspaceId: string,
): Promise<{ members: TeamMember[]; invitations: PendingInvite[] }> {
  const [members, invitations] = await Promise.all([
    db
      .select({
        userId: workspaceMembers.userId,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      // Owners first, then most recently joined.
      .orderBy(workspaceMembers.role, desc(workspaceMembers.createdAt)),
    db
      .select({
        id: workspaceInvitations.id,
        email: workspaceInvitations.email,
        role: workspaceInvitations.role,
        invitedAt: workspaceInvitations.createdAt,
        expiresAt: workspaceInvitations.expiresAt,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.status, 'pending'),
        ),
      )
      .orderBy(desc(workspaceInvitations.createdAt)),
  ])
  return { members, invitations }
}

export type InvitationView = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  expired: boolean
  workspaceId: string
  workspaceName: string
  inviterName: string | null
  inviterEmail: string | null
}

/** Look up an invitation by its token, with workspace + inviter context for the
 *  public /invite landing page. */
export async function getInvitationByToken(token: string): Promise<InvitationView | null> {
  const [row] = await db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      status: workspaceInvitations.status,
      expiresAt: workspaceInvitations.expiresAt,
      workspaceId: workspaceInvitations.workspaceId,
      workspaceName: workspaces.name,
      inviterName: users.name,
      inviterEmail: users.email,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvitations.invitedById))
    .where(eq(workspaceInvitations.token, token))
    .limit(1)
  if (!row) return null
  // Compute expiry here (a plain data fn) so React render code stays pure.
  return { ...row, expired: row.expiresAt.getTime() < Date.now() }
}

export type AcceptResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string }

/**
 * Validate an invite token against an authenticated user and join them to the
 * workspace. Shared by the `acceptInvitation` action and signup. Idempotent
 * (re-accepting is a no-op). The caller owns cookie-setting and redirects.
 */
export async function acceptInvitationByToken(
  token: string,
  userId: string,
  userEmail: string,
): Promise<AcceptResult> {
  const invite = await getInvitationByToken(token)
  if (!invite) return { ok: false, error: 'This invitation is invalid.' }
  if (invite.status !== 'pending') return { ok: false, error: 'This invitation is no longer valid.' }
  if (invite.expiresAt.getTime() < Date.now())
    return { ok: false, error: 'This invitation has expired.' }
  if (invite.email.toLowerCase() !== userEmail.toLowerCase())
    return { ok: false, error: `This invitation was sent to ${invite.email}.` }

  await db.transaction(async (tx) => {
    await tx
      .insert(workspaceMembers)
      .values({
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role as "owner" | "member",
      })
      .onConflictDoNothing()
    await tx
      .update(workspaceInvitations)
      .set({ status: 'accepted' })
      .where(eq(workspaceInvitations.id, invite.id))
  })

  return { ok: true, workspaceId: invite.workspaceId }
}
