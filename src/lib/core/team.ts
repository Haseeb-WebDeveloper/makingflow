/**
 * Workspace membership and invitations, transport-agnostic.
 *
 * Every function here is owner-only, checked through `authorize(ctx, { action:
 * "manage_team" })` — the same `OWNER_ONLY` table the browser uses, so a
 * member's API key holding `team:write` still cannot invite anyone. Two gates,
 * neither able to override the other.
 *
 * THE INVITE LINK IS A BEARER CREDENTIAL. `/invite/<token>` grants workspace
 * membership at the invited role to whoever opens it — the token *is* the
 * authorization, which is why the invite page has no other gate. That is fine
 * in a browser, where it goes to the person who typed the email address. It is
 * not fine handed to a language model, which may quote it into a summary, a
 * commit message or a chat log.
 *
 * It is returned here, because the browser genuinely needs it. Keeping it out
 * of the MCP surface is the TOOL's job: `defineTool` requires a closed Zod
 * output schema, so the tool builds its result without the link and a field
 * that is not in the schema cannot ship. Redaction at the boundary that already
 * exists beats an optional field every caller has to remember to not read.
 *
 * `acceptInvitation` deliberately does NOT live here. It writes the active
 * workspace cookie, and it is the one operation where the caller is by
 * definition not yet a member — there is no AuthContext to have.
 */

import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { users, workspaceInvitations, workspaceMembers } from "@/lib/db/schema"
import { authorize, type AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { getOwnerCount } from "@/lib/data/team"
import { sendEmail, isEmailConfigured } from "@/lib/email/provider"
import { inviteEmailHtml } from "@/lib/email/templates"

export type Result = { success: true } | { success: false; error: string }
export type InviteResult =
  | { success: true; inviteLink: string; emailed: boolean }
  | { success: false; error: string }

const roleSchema = z.enum(["owner", "member"])
const emailSchema = z.string().trim().toLowerCase().email()

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000"
}

/** Owner gate, shared by everything in this module. */
function requireTeamAdmin(ctx: AuthContext): string | null {
  return authorize(ctx, { action: "manage_team" })
}

/** The inviter's display name, for the email. The context carries no name. */
async function inviterName(ctx: AuthContext): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1)
  return row?.name ?? null
}

export async function inviteMember(
  ctx: AuthContext,
  emailRaw: string,
  roleRaw: string,
): Promise<InviteResult> {
  const denied = requireTeamAdmin(ctx)
  if (denied) return { success: false, error: denied }

  const parsedEmail = emailSchema.safeParse(emailRaw)
  if (!parsedEmail.success) return { success: false, error: "Enter a valid email address." }
  const parsedRole = roleSchema.safeParse(roleRaw)
  if (!parsedRole.success) return { success: false, error: "Invalid role." }
  const email = parsedEmail.data
  const role = parsedRole.data

  const [existingMember] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(users.email, email)))
    .limit(1)
  if (existingMember) return { success: false, error: "That person is already a member." }

  // Reuse an existing pending invite rather than stacking duplicates, so
  // inviting the same person twice is idempotent.
  const [pending] = await db
    .select({ token: workspaceInvitations.token })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, ctx.workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .limit(1)

  let token = pending?.token
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, "")
    await db.insert(workspaceInvitations).values({
      workspaceId: ctx.workspaceId,
      email,
      role,
      token,
      invitedById: ctx.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
  }

  const inviteLink = `${siteUrl()}/invite/${token}`
  let emailed = false
  if (isEmailConfigured()) {
    const res = await sendEmail({
      to: [email],
      subject: `Join ${ctx.workspaceName} on MakingFlow`,
      html: inviteEmailHtml({
        workspaceName: ctx.workspaceName,
        inviterName: await inviterName(ctx),
        link: inviteLink,
      }),
    })
    emailed = res.ok
    if (!res.ok) console.error("[inviteMember] email failed", res.error)
  }

  invalidate(ctx, { paths: ["/settings/workspace"] })
  return { success: true, inviteLink, emailed }
}

export async function resendInvitation(
  ctx: AuthContext,
  id: string,
): Promise<InviteResult> {
  const denied = requireTeamAdmin(ctx)
  if (denied) return { success: false, error: denied }

  const [invite] = await db
    .select({ email: workspaceInvitations.email, token: workspaceInvitations.token })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, id),
        eq(workspaceInvitations.workspaceId, ctx.workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .limit(1)
  if (!invite) return { success: false, error: "Invitation not found." }

  const inviteLink = `${siteUrl()}/invite/${invite.token}`
  let emailed = false
  if (isEmailConfigured()) {
    const res = await sendEmail({
      to: [invite.email],
      subject: `Join ${ctx.workspaceName} on MakingFlow`,
      html: inviteEmailHtml({
        workspaceName: ctx.workspaceName,
        inviterName: await inviterName(ctx),
        link: inviteLink,
      }),
    })
    emailed = res.ok
  }

  return { success: true, inviteLink, emailed }
}

export async function revokeInvitation(ctx: AuthContext, id: string): Promise<Result> {
  const denied = requireTeamAdmin(ctx)
  if (denied) return { success: false, error: denied }

  await db
    .update(workspaceInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(workspaceInvitations.id, id),
        eq(workspaceInvitations.workspaceId, ctx.workspaceId),
      ),
    )
  invalidate(ctx, { paths: ["/settings/workspace"] })
  return { success: true }
}

export async function removeMember(ctx: AuthContext, userId: string): Promise<Result> {
  const denied = requireTeamAdmin(ctx)
  if (denied) return { success: false, error: denied }

  if (userId === ctx.userId) return { success: false, error: "You can't remove yourself." }

  const [target] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1)
  if (!target) return { success: false, error: "Member not found." }
  // A workspace with no owner cannot be administered by anyone, ever again.
  if (target.role === "owner" && (await getOwnerCount(ctx.workspaceId)) <= 1)
    return { success: false, error: "A workspace must keep at least one owner." }

  await db
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)),
    )
  invalidate(ctx, { paths: ["/settings/workspace"] })
  return { success: true }
}

export async function changeMemberRole(
  ctx: AuthContext,
  userId: string,
  roleRaw: string,
): Promise<Result> {
  const denied = requireTeamAdmin(ctx)
  if (denied) return { success: false, error: denied }

  const parsedRole = roleSchema.safeParse(roleRaw)
  if (!parsedRole.success) return { success: false, error: "Invalid role." }
  const role = parsedRole.data

  const [target] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1)
  if (!target) return { success: false, error: "Member not found." }
  if (target.role === "owner" && role !== "owner" && (await getOwnerCount(ctx.workspaceId)) <= 1)
    return { success: false, error: "A workspace must keep at least one owner." }

  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)),
    )
  invalidate(ctx, { paths: ["/settings/workspace"] })
  return { success: true }
}
