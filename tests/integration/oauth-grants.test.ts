/**
 * Consent records, and the rule that makes them safe to hold.
 *
 * A grant is a snapshot of what a user agreed to. The token that rides on it is
 * a snapshot too, minted once and valid for as long as its expiry says. Neither
 * knows that someone was removed from a workspace this morning — which is why
 * NEITHER is trusted to answer "what may this call reach". The grant is
 * intersected with live `workspace_members` on every request, exactly as an API
 * key's grant is, so it can lose reach and can never gain it.
 *
 * The other property worth pinning is client binding. A user may connect several
 * apps with different permissions, and a token issued to one must not be able to
 * act through another's consent — otherwise the narrowest grant on the account
 * is decorative.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  mcpOauthGrantWorkspaces,
  mcpOauthGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import {
  grantForToken,
  listConnectedApps,
  recordConsent,
  revokeGrant,
} from "@/lib/mcp/oauth/grants"
import type { VerifiedToken } from "@/lib/mcp/oauth/verify"

let seq = 0

async function seedUser(label: string) {
  seq += 1
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${label}-${seq}-${Date.now()}@example.test`, name: label })
    .returning({ id: users.id })
  return user.id
}

async function seedWorkspace(userId: string, name: string, role: "owner" | "member" = "owner") {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name, slug: `ws-oauth-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role })
  return ws.id
}

function token(subject: string, clientId = "client_abc"): VerifiedToken {
  return { subject, clientId, expiresAt: new Date(Date.now() + 600_000) }
}

describe("oauth grants", () => {
  let userId: string
  let alphaId: string
  let betaId: string

  beforeEach(async () => {
    userId = await seedUser("owner")
    alphaId = await seedWorkspace(userId, "Alpha")
    betaId = await seedWorkspace(userId, "Beta")
  })

  describe("recording consent", () => {
    test("writes the scopes and workspaces the user chose", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read", "forms:write"],
        workspaceIds: [alphaId],
      })

      const resolved = await grantForToken(token(userId))
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.grant.grantId).toBe(grantId)
      expect([...resolved.grant.scopes].sort()).toEqual(["forms:read", "forms:write"])
      expect(resolved.grant.workspaces.map((w) => w.name)).toEqual(["Alpha"])
      expect(resolved.grant.workspaces[0].role).toBe("owner")
    })

    test("re-consenting REPLACES rather than accumulates", async () => {
      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read", "forms:write", "submissions:read"],
        workspaceIds: [alphaId, betaId],
      })
      // The user reconnects and this time picks less. A union here would turn
      // every re-consent into a widening — the opposite of what they just did.
      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [betaId],
      })

      const resolved = await grantForToken(token(userId))
      if (!resolved.ok) throw new Error(resolved.error)
      expect([...resolved.grant.scopes]).toEqual(["forms:read"])
      expect(resolved.grant.workspaces.map((w) => w.name)).toEqual(["Beta"])

      // And it is still one row, not two.
      expect(await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.userId, userId)))
        .toHaveLength(1)
    })

    test("re-consenting un-revokes, because the user is saying yes again", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      await revokeGrant(userId, grantId)
      expect((await grantForToken(token(userId))).ok).toBe(false)

      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      expect((await grantForToken(token(userId))).ok).toBe(true)
    })

    test("a workspace the user does not belong to is never written", async () => {
      // The consent form is a browser POST, and a browser POST is not a trust
      // boundary. This is checked at write time as well as at read time so the
      // row on disk is never a lie.
      const stranger = await seedUser("stranger")
      const theirs = await seedWorkspace(stranger, "Theirs")

      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId, theirs],
      })

      const rows = await db
        .select({ workspaceId: mcpOauthGrantWorkspaces.workspaceId })
        .from(mcpOauthGrantWorkspaces)
      expect(rows.map((r) => r.workspaceId)).toEqual([alphaId])
    })

    test("consent naming only workspaces the user is not in is refused outright", async () => {
      const stranger = await seedUser("stranger")
      const theirs = await seedWorkspace(stranger, "Theirs")

      await expect(
        recordConsent({
          userId,
          clientId: "client_abc",
          clientName: "Claude",
          scopes: ["forms:read"],
          workspaceIds: [theirs],
        }),
      ).rejects.toThrow(/no workspace/i)
    })
  })

  describe("resolving a token", () => {
    beforeEach(async () => {
      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read", "forms:write"],
        workspaceIds: [alphaId, betaId],
      })
    })

    test("a token for a different client does not ride on this consent", async () => {
      // The narrowest grant on an account would be decorative if it did. The
      // second client gets its OWN grant, empty, rather than inheriting the
      // first one's workspaces.
      const resolved = await grantForToken(token(userId, "client_other"))
      expect(resolved).toMatchObject({ ok: false, status: 403 })
      if (resolved.ok) throw new Error("expected a refusal")
      expect(resolved.error).toMatch(/isn't set up yet/)

      const rows = await db
        .select({ clientId: mcpOauthGrants.clientId })
        .from(mcpOauthGrants)
        .where(eq(mcpOauthGrants.userId, userId))
      expect(rows.map((r) => r.clientId).sort()).toEqual(["client_abc", "client_other"])

      // And the new one reaches nothing.
      const [placeholder] = await db
        .select({ id: mcpOauthGrants.id })
        .from(mcpOauthGrants)
        .where(
          and(eq(mcpOauthGrants.userId, userId), eq(mcpOauthGrants.clientId, "client_other")),
        )
      expect(
        await db
          .select()
          .from(mcpOauthGrantWorkspaces)
          .where(eq(mcpOauthGrantWorkspaces.grantId, placeholder.id)),
      ).toHaveLength(0)
    })

    test("an unknown client's placeholder does not resurrect a revoked grant", async () => {
      // Disconnecting must actually disconnect. If the "never seen this client"
      // path re-created rows indiscriminately, revoking would do nothing from
      // the very next request onwards.
      const [grant] = await db
        .select({ id: mcpOauthGrants.id })
        .from(mcpOauthGrants)
        .where(eq(mcpOauthGrants.userId, userId))
      await revokeGrant(userId, grant.id)

      expect(await grantForToken(token(userId))).toEqual({
        ok: false,
        status: 401,
        error: "Access for this app has been revoked",
      })

      const [after] = await db
        .select({ revokedAt: mcpOauthGrants.revokedAt })
        .from(mcpOauthGrants)
        .where(eq(mcpOauthGrants.id, grant.id))
      expect(after.revokedAt).not.toBeNull()
    })

    test("losing membership drops that workspace on the very next call", async () => {
      // No revocation sweep, no token to chase down — the intersection with
      // live membership is what makes that true.
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, alphaId))

      const resolved = await grantForToken(token(userId))
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.grant.workspaces.map((w) => w.name)).toEqual(["Beta"])
    })

    test("losing every workspace is a 403, not a 401", async () => {
      // The credential is fine; the access is gone. Re-authorising would not
      // help, and telling the client to try would send it into a loop.
      await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId))

      expect(await grantForToken(token(userId))).toEqual({
        ok: false,
        status: 403,
        error: "This app's workspace access has been removed",
      })
    })

    test("a demoted owner loses owner powers without the grant changing", async () => {
      await db
        .update(workspaceMembers)
        .set({ role: "member" })
        .where(eq(workspaceMembers.workspaceId, alphaId))

      const resolved = await grantForToken(token(userId))
      if (!resolved.ok) throw new Error(resolved.error)
      // The role is read live, never cached on the grant.
      expect(resolved.grant.workspaces.find((w) => w.name === "Alpha")?.role).toBe("member")
    })

    test("a revoked grant stops working immediately", async () => {
      const [grant] = await db
        .select({ id: mcpOauthGrants.id })
        .from(mcpOauthGrants)
        .where(eq(mcpOauthGrants.userId, userId))
      await revokeGrant(userId, grant.id)

      expect(await grantForToken(token(userId))).toEqual({
        ok: false,
        status: 401,
        error: "Access for this app has been revoked",
      })
    })

    test("a token for an account that no longer exists resolves to nothing", async () => {
      expect(await grantForToken(token(randomUUID()))).toEqual({
        ok: false,
        status: 401,
        error: "Unknown account",
      })
    })

    test("an unknown scope stored on the grant is dropped, not passed through", async () => {
      // Scopes are a closed set. A row holding something outside it — from an
      // older release, or a hand edit — must not become a permission.
      await db
        .update(mcpOauthGrants)
        .set({ scopes: ["forms:read", "not-a-real-scope", "admin:*"] })
        .where(eq(mcpOauthGrants.userId, userId))

      const resolved = await grantForToken(token(userId))
      if (!resolved.ok) throw new Error(resolved.error)
      expect([...resolved.grant.scopes]).toEqual(["forms:read"])
    })
  })

  describe("revoking", () => {
    test("only the owner of a grant can revoke it", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      const stranger = await seedUser("stranger")

      // A grant id is not a capability.
      expect(await revokeGrant(stranger, grantId)).toBe(false)
      expect((await grantForToken(token(userId))).ok).toBe(true)

      expect(await revokeGrant(userId, grantId)).toBe(true)
      expect((await grantForToken(token(userId))).ok).toBe(false)
    })

    test("the row survives revocation, so the audit trail still resolves", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      await revokeGrant(userId, grantId)

      const [row] = await db
        .select({ revokedAt: mcpOauthGrants.revokedAt })
        .from(mcpOauthGrants)
        .where(eq(mcpOauthGrants.id, grantId))
      expect(row.revokedAt).not.toBeNull()
    })
  })

  describe("the connected-apps list", () => {
    test("shows live grants with their workspaces, and hides revoked ones", async () => {
      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId, betaId],
      })
      const { grantId: gone } = await recordConsent({
        userId,
        clientId: "client_zzz",
        clientName: "Something else",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      await revokeGrant(userId, gone)

      const apps = await listConnectedApps(userId)
      expect(apps).toHaveLength(1)
      expect(apps[0].clientName).toBe("Claude")
      expect(apps[0].workspaces.map((w) => w.name).sort()).toEqual(["Alpha", "Beta"])
    })

    test("does not show another user's connections", async () => {
      await recordConsent({
        userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      const stranger = await seedUser("stranger")
      expect(await listConnectedApps(stranger)).toEqual([])
    })
  })
})
