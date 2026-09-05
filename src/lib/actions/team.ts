"use server"

/**
 * Team Server Actions — the browser's entry point.
 *
 * The five owner-only operations live in src/lib/core/team.ts, shared with the
 * MCP surface. Core returns the invite link because this caller needs to show
 * it; the MCP tool omits it from its output schema, since the link grants
 * membership to whoever holds it.
 *
 * `acceptInvitation` stays here in full: it writes the active-workspace cookie,
 * and it is the one operation whose caller is by definition not yet a member,
 * so there is no AuthContext to build.
 */

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { getRequiredUser } from "@/lib/auth/session"
import { setActiveWorkspaceCookie } from "@/lib/auth/active-workspace"
import { sessionContext } from "@/lib/auth/context-web"
import * as teamCore from "@/lib/core/team"
import { acceptInvitationByToken } from "@/lib/data/team"

type Result = { success: true } | { success: false; error: string }
type InviteResult =
  | { success: true; inviteLink: string; emailed: boolean }
  | { success: false; error: string }

/** Invite someone to the active workspace by email. Owner-only. */
export async function inviteMember(emailRaw: string, roleRaw: string): Promise<InviteResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return teamCore.inviteMember(session.ctx, emailRaw, roleRaw)
}

/** Re-send (or surface the link for) a pending invitation. Owner-only. */
export async function resendInvitation(id: string): Promise<InviteResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return teamCore.resendInvitation(session.ctx, id)
}

/** Revoke a pending invitation. Owner-only. */
export async function revokeInvitation(id: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return teamCore.revokeInvitation(session.ctx, id)
}

/** Remove a member from the active workspace. Owner-only. */
export async function removeMember(userId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return teamCore.removeMember(session.ctx, userId)
}

/** Change a member's role. Owner-only; never strands a workspace without an owner. */
export async function changeMemberRole(userId: string, roleRaw: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return teamCore.changeMemberRole(session.ctx, userId, roleRaw)
}

/** Accept an invitation as the signed-in user. Sets the joined workspace active. */
export async function acceptInvitation(token: string): Promise<Result> {
  const user = await getRequiredUser()
  const res = await acceptInvitationByToken(token, user.id, user.email)
  if (!res.ok) return { success: false, error: res.error }

  const store = await cookies()
  setActiveWorkspaceCookie(store, res.workspaceId)
  revalidatePath("/", "layout")
  return { success: true }
}
