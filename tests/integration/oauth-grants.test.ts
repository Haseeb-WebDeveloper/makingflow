/**
 * Consent records, and the rule that makes them safe to hold.
 *
 * A grant is a snapshot of what a user agreed to, and the token riding on it is
 * a reference to that snapshot. Neither knows that someone was removed from a
 * workspace this morning — which is why NEITHER is trusted to answer "what may
 * this call reach". The grant is intersected with live `workspace_members` on
 * every request, exactly as an API key's grant is, so it can lose reach and can
 * never gain it.
 *
 * Because we issue the tokens ourselves, a token points straight at one grant
 * row. There is no subject to resolve and no client id to cross-check, so the
 * "token from app A riding on the consent given to app B" failure is not
 * defended against here — it is structurally impossible.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  mcpOauthClients,
  mcpOauthGrantWorkspaces,
  mcpOauthGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import {
  grantForAccessToken,
  listConnectedApps,
  recordConsent,
  revokeGrant,
} from "@/lib/mcp/oauth/grants"

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

async function seedClient(name: string) {
  const [client] = await db
    .insert(mcpOauthClients)
    .values({ clientName: name, redirectUris: ["https://client.example/callback"] })
    .returning({ id: mcpOauthClients.id })
  return client.id
}

describe("oauth grants", () => {
  let userId: string
  let alphaId: string
  let betaId: string
  let clientId: string

  beforeEach(async () => {
    userId = await seedUser("owner")
    alphaId = await seedWorkspace(userId, "Alpha")
    betaId = await seedWorkspace(userId, "Beta")
    clientId = await seedClient("Claude")
  })

  describe("recording consent", () => {
    test("writes the scopes and workspaces the user chose", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read", "forms:write"],
        workspaceIds: [alphaId],
      })

      const resolved = await grantForAccessToken(grantId)
      if (!resolved.ok) throw new Error(resolved.error)
      expect([...resolved.grant.scopes].sort()).toEqual(["forms:read", "forms:write"])
      expect(resolved.grant.workspaces.map((w) => w.name)).toEqual(["Alpha"])
      expect(resolved.grant.workspaces[0].role).toBe("owner")
      expect(resolved.grant.userId).toBe(userId)
    })

    test("re-consenting REPLACES rather than accumulates", async () => {
      await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read", "forms:write", "submissions:read"],
        workspaceIds: [alphaId, betaId],
      })
      // The user reconnects and this time picks less. A union here would turn
      // every re-consent into a widening — the opposite of what they just did.
      const { grantId } = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [betaId],
      })

      const resolved = await grantForAccessToken(grantId)
      if (!resolved.ok) throw new Error(resolved.error)
      expect([...resolved.grant.scopes]).toEqual(["forms:read"])
      expect(resolved.grant.workspaces.map((w) => w.name)).toEqual(["Beta"])

      // And it is still one row, not two.
      expect(
        await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.userId, userId)),
      ).toHaveLength(1)
    })

    test("re-consenting un-revokes, because the user is saying yes again", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      await revokeGrant(userId, grantId)
      expect((await grantForAccessToken(grantId)).ok).toBe(false)

      await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      expect((await grantForAccessToken(grantId)).ok).toBe(true)
    })

    test("two clients get two grants, with independent permissions", async () => {
      // The narrowest grant on an account must not be decorative.
      const other = await seedClient("Some other app")
      const mine = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read", "forms:write"],
        workspaceIds: [alphaId, betaId],
      })
      const theirs = await recordConsent({
        userId,
        clientId: other,
        clientName: "Some other app",
        scopes: ["forms:read"],
        workspaceIds: [betaId],
      })

      expect(mine.grantId).not.toBe(theirs.grantId)
      const a = await grantForAccessToken(mine.grantId)
      const b = await grantForAccessToken(theirs.grantId)
      if (!a.ok || !b.ok) throw new Error("expected both to resolve")

      expect(a.grant.workspaces).toHaveLength(2)
      expect(b.grant.workspaces.map((w) => w.name)).toEqual(["Beta"])
      expect([...b.grant.scopes]).toEqual(["forms:read"])
    })

    test("a workspace the user does not belong to is never written", async () => {
      // The consent form is a browser POST, and a browser POST is not a trust
      // boundary. This is checked at write time as well as at read time so the
      // row on disk is never a lie.
      const stranger = await seedUser("stranger")
      const theirs = await seedWorkspace(stranger, "Theirs")

      const { grantId } = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId, theirs],
      })

      const rows = await db
        .select({ workspaceId: mcpOauthGrantWorkspaces.workspaceId })
        .from(mcpOauthGrantWorkspaces)
        .where(eq(mcpOauthGrantWorkspaces.grantId, grantId))
      expect(rows.map((r) => r.workspaceId)).toEqual([alphaId])
    })

    test("consent naming only workspaces the user is not in is refused outright", async () => {
      const stranger = await seedUser("stranger")
      const theirs = await seedWorkspace(stranger, "Theirs")

      await expect(
        recordConsent({
          userId,
          clientId,
          clientName: "Claude",
          scopes: ["forms:read"],
          workspaceIds: [theirs],
        }),
      ).rejects.toThrow(/no workspace/i)
    })
  })

  describe("resolving a grant", () => {
    let grantId: string

    beforeEach(async () => {
      ;({ grantId } = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read", "forms:write"],
        workspaceIds: [alphaId, betaId],
      }))
    })

    test("losing membership drops that workspace on the very next call", async () => {
      // No revocation sweep, no token to chase down — the intersection with
      // live membership is what makes that true.
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, alphaId))

      const resolved = await grantForAccessToken(grantId)
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.grant.workspaces.map((w) => w.name)).toEqual(["Beta"])
    })

    test("losing every workspace is a 403, not a 401", async () => {
      // The credential is fine; the access is gone. Re-authorising would not
      // help, and telling the client to try would send it into a loop.
      await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId))

      expect(await grantForAccessToken(grantId)).toMatchObject({ ok: false, status: 403 })
    })

    test("a demoted owner loses owner powers without the grant changing", async () => {
      await db
        .update(workspaceMembers)
        .set({ role: "member" })
        .where(eq(workspaceMembers.workspaceId, alphaId))

      const resolved = await grantForAccessToken(grantId)
      if (!resolved.ok) throw new Error(resolved.error)
      // The role is read live, never cached on the grant.
      expect(resolved.grant.workspaces.find((w) => w.name === "Alpha")?.role).toBe("member")
    })

    test("a revoked grant stops working immediately", async () => {
      await revokeGrant(userId, grantId)
      expect(await grantForAccessToken(grantId)).toEqual({
        ok: false,
        status: 401,
        error: "Access for this app has been revoked",
      })
    })

    test("a grant that no longer exists resolves to nothing", async () => {
      expect(await grantForAccessToken(randomUUID())).toEqual({
        ok: false,
        status: 401,
        error: "This connection no longer exists",
      })
    })

    test("an unknown scope stored on the grant is dropped, not passed through", async () => {
      // Scopes are a closed set. A row holding something outside it — from an
      // older release, or a hand edit — must not become a permission.
      await db
        .update(mcpOauthGrants)
        .set({ scopes: ["forms:read", "not-a-real-scope", "admin:*"] })
        .where(eq(mcpOauthGrants.id, grantId))

      const resolved = await grantForAccessToken(grantId)
      if (!resolved.ok) throw new Error(resolved.error)
      expect([...resolved.grant.scopes]).toEqual(["forms:read"])
    })

    test("deleting the client takes its grants with it", async () => {
      await db.delete(mcpOauthClients).where(eq(mcpOauthClients.id, clientId))
      expect(await grantForAccessToken(grantId)).toMatchObject({ ok: false, status: 401 })
    })
  })

  describe("revoking", () => {
    test("only the owner of a grant can revoke it", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      const stranger = await seedUser("stranger")

      // A grant id is not a capability.
      expect(await revokeGrant(stranger, grantId)).toBe(false)
      expect((await grantForAccessToken(grantId)).ok).toBe(true)

      expect(await revokeGrant(userId, grantId)).toBe(true)
      expect((await grantForAccessToken(grantId)).ok).toBe(false)
    })

    test("the row survives revocation, so the audit trail still resolves", async () => {
      const { grantId } = await recordConsent({
        userId,
        clientId,
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
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId, betaId],
      })
      const other = await seedClient("Something else")
      const { grantId: gone } = await recordConsent({
        userId,
        clientId: other,
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
        clientId,
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [alphaId],
      })
      const stranger = await seedUser("stranger")
      expect(await listConnectedApps(stranger)).toEqual([])
    })
  })
})
