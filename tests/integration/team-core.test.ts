/**
 * Team management, and the two rules that keep a workspace administrable.
 *
 * This is the first core module gated on a ROLE rather than only on tenancy, so
 * it is where the two-gate design gets exercised: `team:write` on a key is not
 * enough, because `authorize` also runs `can(ctx.role, "manage_team")` from the
 * same OWNER_ONLY table the browser uses. A member's key cannot invite anyone
 * no matter what scopes it was granted.
 *
 * The last-owner guard matters more than it looks. A workspace with no owner
 * cannot be administered by anybody, ever again — there is no super-admin to
 * appeal to — so both the remove and demote paths have to refuse.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { users, workspaceInvitations, workspaceMembers, workspaces } from "@/lib/db/schema"
import * as teamCore from "@/lib/core/team"
import { getOwnerCount } from "@/lib/data/team"
import { testContext } from "../helpers/context"

let seq = 0

async function seedUser(label: string) {
  seq += 1
  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: `${label}-${seq}-${Date.now()}@example.test`,
      name: label,
    })
    .returning({ id: users.id })
  return user.id
}

describe("core/team", () => {
  let ownerId: string
  let memberId: string
  let workspaceId: string

  beforeEach(async () => {
    seq += 1
    ownerId = await seedUser("owner")
    memberId = await seedUser("member")
    const [ws] = await db
      .insert(workspaces)
      .values({ name: `WS ${seq}`, slug: `ws-team-${seq}-${Date.now()}` })
      .returning({ id: workspaces.id })
    workspaceId = ws.id
    await db.insert(workspaceMembers).values([
      { workspaceId, userId: ownerId, role: "owner" },
      { workspaceId, userId: memberId, role: "member" },
    ])
  })

  const owner = () => testContext({ userId: ownerId, workspaceId, role: "owner" })
  const member = () => testContext({ userId: memberId, workspaceId, role: "member" })

  describe("the owner gate", () => {
    test("a member holding every scope is still refused every team operation", async () => {
      // `member()` carries ALL_SCOPES, so `team:write` passes and the role check
      // is the only thing standing here. Two gates, neither able to override the
      // other — a key cannot grant its holder more than their membership has.
      expect(await teamCore.inviteMember(member(), "new@example.test", "member")).toEqual({
        success: false,
        error: "Only owners can do that",
      })
      expect(await teamCore.removeMember(member(), ownerId)).toEqual({
        success: false,
        error: "Only owners can do that",
      })
      expect(await teamCore.changeMemberRole(member(), ownerId, "member")).toEqual({
        success: false,
        error: "Only owners can do that",
      })
      expect(await teamCore.revokeInvitation(member(), randomUUID())).toEqual({
        success: false,
        error: "Only owners can do that",
      })

      // Refused, not merely unsuccessful: the owner is still an owner.
      expect(await getOwnerCount(workspaceId)).toBe(1)
    })
  })

  describe("invitations", () => {
    test("inviting twice reuses the pending invite rather than stacking duplicates", async () => {
      const first = await teamCore.inviteMember(owner(), "invitee@example.test", "member")
      const second = await teamCore.inviteMember(owner(), "invitee@example.test", "member")
      if (!first.success || !second.success) throw new Error("invite failed")

      expect(second.inviteLink).toBe(first.inviteLink)
      const rows = await db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspaceId))
      expect(rows).toHaveLength(1)
    })

    test("refuses to invite someone who is already a member", async () => {
      const [existing] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, memberId))

      expect(await teamCore.inviteMember(owner(), existing.email, "member")).toEqual({
        success: false,
        error: "That person is already a member.",
      })
    })

    test("rejects a malformed address before writing anything", async () => {
      expect(await teamCore.inviteMember(owner(), "not-an-email", "member")).toEqual({
        success: false,
        error: "Enter a valid email address.",
      })
      expect(
        await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId)),
      ).toHaveLength(0)
    })

    test("cannot revoke an invitation belonging to another workspace", async () => {
      const otherOwner = await seedUser("other")
      seq += 1
      const [otherWs] = await db
        .insert(workspaces)
        .values({ name: "Other", slug: `ws-other-${seq}-${Date.now()}` })
        .returning({ id: workspaces.id })
      await db
        .insert(workspaceMembers)
        .values({ workspaceId: otherWs.id, userId: otherOwner, role: "owner" })

      const theirs = await teamCore.inviteMember(
        testContext({ userId: otherOwner, workspaceId: otherWs.id, role: "owner" }),
        "someone@example.test",
        "member",
      )
      expect(theirs.success).toBe(true)
      const [invite] = await db
        .select({ id: workspaceInvitations.id })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, otherWs.id))

      // Silently a no-op rather than an error, because the update is scoped —
      // what matters is that their invitation is untouched.
      await teamCore.revokeInvitation(owner(), invite.id)
      const [after] = await db
        .select({ status: workspaceInvitations.status })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, invite.id))
      expect(after.status).toBe("pending")
    })
  })

  describe("the last-owner rule", () => {
    test("one owner can remove another, leaving the workspace administrable", async () => {
      // The last-owner check in removeMember is defence in depth rather than a
      // reachable branch: the caller is an owner, so if the target is also an
      // owner there are at least two — and if the target IS the caller, the
      // self-removal check fires first. Both guards are asserted separately;
      // this test pins the case that actually happens.
      const second = await seedUser("second-owner")
      await db.insert(workspaceMembers).values({ workspaceId, userId: second, role: "owner" })
      const secondCtx = testContext({ userId: second, workspaceId, role: "owner" })

      expect(await teamCore.removeMember(secondCtx, ownerId)).toEqual({ success: true })
      expect(await getOwnerCount(workspaceId)).toBe(1)
    })

    test("the only owner cannot demote themselves to member", async () => {
      expect(await teamCore.changeMemberRole(owner(), ownerId, "member")).toEqual({
        success: false,
        error: "A workspace must keep at least one owner.",
      })
      // Still an owner, so the workspace is still administrable.
      const [row] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, ownerId)))
      expect(row.role).toBe("owner")
    })

    test("promoting a member then demoting the original owner is allowed", async () => {
      expect(await teamCore.changeMemberRole(owner(), memberId, "owner")).toEqual({ success: true })
      // Now there are two, so stepping down strands nobody.
      expect(await teamCore.changeMemberRole(owner(), ownerId, "member")).toEqual({ success: true })
    })

    test("you cannot remove yourself", async () => {
      expect(await teamCore.removeMember(owner(), ownerId)).toEqual({
        success: false,
        error: "You can't remove yourself.",
      })
    })
  })

  test("cannot remove a member of another workspace", async () => {
    const stranger = await seedUser("stranger")
    seq += 1
    const [otherWs] = await db
      .insert(workspaces)
      .values({ name: "Other", slug: `ws-x-${seq}-${Date.now()}` })
      .returning({ id: workspaces.id })
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: otherWs.id, userId: stranger, role: "member" })

    expect(await teamCore.removeMember(owner(), stranger)).toEqual({
      success: false,
      error: "Member not found.",
    })
    expect(
      await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, stranger)),
    ).toHaveLength(1)
  })
})
