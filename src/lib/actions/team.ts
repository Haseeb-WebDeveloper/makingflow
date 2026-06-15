"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, count, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { users, workspaceInvitations, workspaceMembers } from "@/lib/db/schema"
import { getRequiredUser, ACTIVE_WORKSPACE_COOKIE } from "@/lib/auth/session"
import { requireOwner } from "@/lib/auth/permissions"
import { acceptInvitationByToken } from "@/lib/data/team"
import { sendEmail, isEmailConfigured } from "@/lib/email/provider"
import { inviteEmailHtml } from "@/lib/email/templates"

type Result = { success: true } | { success: false; error: string }
type InviteResult =
  | { success: true; inviteLink: string; emailed: boolean }
  | { success: false; error: string }

const roleSchema = z.enum(["owner", "member"])
const emailSchema = z.string().trim().toLowerCase().email()

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000"
}

function setActiveWorkspaceCookie(store: Awaited<ReturnType<typeof cookies>>, id: string) {
  store.set(ACTIVE_WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

/** Switch the caller's active workspace (validated against their memberships). */
export async function switchWorkspace(workspaceId: string): Promise<Result> {
  const user = await getRequiredUser()
  const [member] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
    .limit(1)
  if (!member) return { success: false, error: "Not a member of that workspace" }

  const store = await cookies()
  setActiveWorkspaceCookie(store, workspaceId)
  revalidatePath("/", "layout")
  return { success: true }
}

/** Invite someone to the active workspace by email. Owner-only. */
export async function inviteMember(emailRaw: string, roleRaw: string): Promise<InviteResult> {
  const gate = await requireOwner()
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }
  const ws = gate.workspace
  const user = await getRequiredUser()

  const parsedEmail = emailSchema.safeParse(emailRaw)
  if (!parsedEmail.success) return { success: false, error: "Enter a valid email address." }
  const parsedRole = roleSchema.safeParse(roleRaw)
  if (!parsedRole.success) return { success: false, error: "Invalid role." }
  const email = parsedEmail.data
  const role = parsedRole.data

  // Already a member?
  const [existingMember] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(users.email, email)))
    .limit(1)
  if (existingMember) return { success: false, error: "That person is already a member." }

  // Reuse an existing pending invite (idempotent) rather than stacking duplicates.
  const [pending] = await db
    .select({ token: workspaceInvitations.token })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, ws.id),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .limit(1)

  let token = pending?.token
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, "")
    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      email,
      role,
      token,
      invitedById: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
  }

  const inviteLink = `${siteUrl()}/invite/${token}`
  let emailed = false
  if (isEmailConfigured()) {
    const res = await sendEmail({
      to: [email],
      subject: `Join ${ws.name} on MakingFlow`,
      html: inviteEmailHtml({ workspaceName: ws.name, inviterName: user.name, link: inviteLink }),
    })
    emailed = res.ok
    if (!res.ok) console.error("[inviteMember] email failed", res.error)
  }

  revalidatePath("/settings/team")
  return { success: true, inviteLink, emailed }
}

/** Re-send (or surface the link for) a pending invitation. Owner-only. */
export async function resendInvitation(id: string): Promise<InviteResult> {
  const gate = await requireOwner()
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }
  const ws = gate.workspace
  const user = await getRequiredUser()

  const [invite] = await db
    .select({ email: workspaceInvitations.email, token: workspaceInvitations.token })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, id),
        eq(workspaceInvitations.workspaceId, ws.id),
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
      subject: `Join ${ws.name} on MakingFlow`,
      html: inviteEmailHtml({ workspaceName: ws.name, inviterName: user.name, link: inviteLink }),
    })
    emailed = res.ok
  }
  return { success: true, inviteLink, emailed }
}

/** Revoke a pending invitation. Owner-only. */
export async function revokeInvitation(id: string): Promise<Result> {
  const gate = await requireOwner()
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }
  const ws = gate.workspace

  await db
    .update(workspaceInvitations)
    .set({ status: "revoked" })
    .where(and(eq(workspaceInvitations.id, id), eq(workspaceInvitations.workspaceId, ws.id)))
  revalidatePath("/settings/team")
  return { success: true }
}

async function ownerCount(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner")))
  return row?.c ?? 0
}

/** Remove a member from the active workspace. Owner-only. */
export async function removeMember(userId: string): Promise<Result> {
  const gate = await requireOwner()
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }
  const ws = gate.workspace
  const user = await getRequiredUser()

  if (userId === user.id) return { success: false, error: "You can't remove yourself." }

  const [target] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))
    .limit(1)
  if (!target) return { success: false, error: "Member not found." }
  if (target.role === "owner" && (await ownerCount(ws.id)) <= 1)
    return { success: false, error: "A workspace must keep at least one owner." }

  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))
  revalidatePath("/settings/team")
  return { success: true }
}

/** Change a member's role. Owner-only; never strands a workspace without an owner. */
export async function changeMemberRole(userId: string, roleRaw: string): Promise<Result> {
  const gate = await requireOwner()
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }
  const ws = gate.workspace

  const parsedRole = roleSchema.safeParse(roleRaw)
  if (!parsedRole.success) return { success: false, error: "Invalid role." }
  const role = parsedRole.data

  const [target] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))
    .limit(1)
  if (!target) return { success: false, error: "Member not found." }
  if (target.role === "owner" && role !== "owner" && (await ownerCount(ws.id)) <= 1)
    return { success: false, error: "A workspace must keep at least one owner." }

  await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))
  revalidatePath("/settings/team")
  return { success: true }
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
