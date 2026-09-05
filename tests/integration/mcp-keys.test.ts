/**
 * Creating, listing and revoking MCP keys — the flow behind the /integrations
 * card.
 *
 * The gates here are the ones that matter: only owners may issue a credential
 * that can read every response in a workspace, and nobody may grant a workspace
 * they do not themselves belong to. Both are enforced in core rather than in the
 * dialog, because the request body is not a trust boundary — the browser can
 * post any workspace id it likes.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpApiKeys, users, workspaceMembers, workspaces } from "@/lib/db/schema"
import * as keys from "@/lib/core/mcp-keys"
import { hashApiKey } from "@/lib/integrations/crypto"
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

async function seedWorkspace(userId: string, role: "owner" | "member", label: string) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS ${label} ${seq}`, slug: `ws-${label}-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id, name: workspaces.name })
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role })
  return ws
}

describe("core/mcp-keys", () => {
  let ownerId: string
  let memberId: string
  let wsA: { id: string; name: string }
  let wsB: { id: string; name: string }

  beforeEach(async () => {
    ownerId = await seedUser("owner")
    memberId = await seedUser("member")
    wsA = await seedWorkspace(ownerId, "owner", "a")
    wsB = await seedWorkspace(ownerId, "owner", "b")
    await db.insert(workspaceMembers).values({ workspaceId: wsA.id, userId: memberId, role: "member" })
  })

  const ownerCtx = () => testContext({ userId: ownerId, workspaceId: wsA.id, role: "owner" })
  const memberCtx = () => testContext({ userId: memberId, workspaceId: wsA.id, role: "member" })

  test("an owner creates a key and sees the secret exactly once", async () => {
    const result = await keys.createKey(ownerCtx(), {
      name: "Claude Code",
      scopes: ["forms:read", "forms:write"],
      workspaceIds: [wsA.id],
    })
    if (!result.success) throw new Error(result.error)

    expect(result.token.startsWith("mf_sk_live_")).toBe(true)

    // The token is NOT recoverable: only its HMAC is stored, and the listing
    // exposes the prefix alone.
    const [row] = await db.select().from(mcpApiKeys).where(eq(mcpApiKeys.id, result.key.id))
    expect(row.keyHash).toBe(hashApiKey(result.token))
    expect(JSON.stringify(row)).not.toContain(result.token)

    const listed = await keys.listKeys(ownerCtx())
    expect(listed).toHaveLength(1)
    expect(listed[0].prefix.length).toBeLessThan(result.token.length)
    expect(JSON.stringify(listed)).not.toContain(result.token)
  })

  test("a member can create one — a key never exceeds its creator", async () => {
    const result = await keys.createKey(memberCtx(), {
      name: "My own key",
      scopes: ["submissions:read"],
      workspaceIds: [wsA.id],
    })
    // Members already read responses in the browser. A key is the same access
    // from a different tool: its role is re-read from workspace_members on
    // every request, so it can never do more than the person who made it.
    expect(result.success).toBe(true)
  })

  test("a member cannot grant a workspace they do not belong to", async () => {
    // The member belongs to A only. B is the owner's.
    const result = await keys.createKey(memberCtx(), {
      name: "Reaching",
      scopes: ["forms:read"],
      workspaceIds: [wsA.id, wsB.id],
    })
    expect(result).toEqual({
      success: false,
      error: "You can only grant access to workspaces you belong to.",
    })
  })

  test("one key can cover several workspaces", async () => {
    const result = await keys.createKey(ownerCtx(), {
      name: "Everything",
      scopes: ["forms:read"],
      workspaceIds: [wsA.id, wsB.id],
    })
    if (!result.success) throw new Error(result.error)

    expect(result.key.workspaces.map((w) => w.id).sort()).toEqual([wsA.id, wsB.id].sort())
    // And it shows up on BOTH workspaces' integrations pages, so an owner can
    // audit what reaches the workspace they are looking at.
    const fromB = await keys.listKeys(
      testContext({ userId: ownerId, workspaceId: wsB.id, role: "owner" }),
    )
    expect(fromB.map((k) => k.name)).toContain("Everything")
  })

  test("cannot grant a workspace the creator does not belong to", async () => {
    const strangerId = await seedUser("stranger")
    const theirs = await seedWorkspace(strangerId, "owner", "stranger")

    const result = await keys.createKey(ownerCtx(), {
      name: "Overreach",
      scopes: ["forms:read"],
      workspaceIds: [wsA.id, theirs.id],
    })
    // The browser can post any id; core is where that stops.
    expect(result).toEqual({
      success: false,
      error: "You can only grant access to workspaces you belong to.",
    })
    expect(await db.select().from(mcpApiKeys)).toHaveLength(0)
  })

  test("rejects an empty permission set rather than minting a useless key", async () => {
    const result = await keys.createKey(ownerCtx(), {
      name: "Nothing",
      scopes: [],
      workspaceIds: [wsA.id],
    })
    expect(result).toEqual({ success: false, error: "Choose at least one permission." })
  })

  test("revoking takes effect immediately and hides the key from the list", async () => {
    const created = await keys.createKey(ownerCtx(), {
      name: "Temporary",
      scopes: ["forms:read"],
      workspaceIds: [wsA.id],
    })
    if (!created.success) throw new Error(created.error)

    expect(await keys.revokeKey(ownerCtx(), created.key.id)).toEqual({ success: true })

    const [row] = await db.select().from(mcpApiKeys).where(eq(mcpApiKeys.id, created.key.id))
    expect(row.revokedAt).not.toBeNull()
    expect(await keys.listKeys(ownerCtx())).toHaveLength(0)
  })

  test("a member cannot revoke someone else's key", async () => {
    const created = await keys.createKey(ownerCtx(), {
      name: "Owner's key",
      scopes: ["forms:read"],
      workspaceIds: [wsA.id],
    })
    if (!created.success) throw new Error(created.error)

    expect(await keys.revokeKey(memberCtx(), created.key.id)).toEqual({
      success: false,
      error: "You can only revoke keys you created",
    })
    expect(await keys.listKeys(ownerCtx())).toHaveLength(1)
  })

  test("an owner cannot revoke a key that does not reach their workspace", async () => {
    const strangerId = await seedUser("stranger")
    const theirs = await seedWorkspace(strangerId, "owner", "stranger")
    const strangerCtx = testContext({
      userId: strangerId,
      workspaceId: theirs.id,
      role: "owner",
    })
    const created = await keys.createKey(strangerCtx, {
      name: "Not yours",
      scopes: ["forms:read"],
      workspaceIds: [theirs.id],
    })
    if (!created.success) throw new Error(created.error)

    // Same message as a key that does not exist — one workspace's owner learns
    // nothing about another's credentials.
    expect(await keys.revokeKey(ownerCtx(), created.key.id)).toEqual({
      success: false,
      error: "Key not found",
    })
  })

  test("grantableWorkspaces offers exactly the caller's memberships", async () => {
    const offered = await keys.grantableWorkspaces(ownerCtx())
    expect(offered.map((w) => w.id).sort()).toEqual([wsA.id, wsB.id].sort())

    // The member belongs to A only, so B is not on their list.
    const memberOffered = await keys.grantableWorkspaces(memberCtx())
    expect(memberOffered.map((w) => w.id)).toEqual([wsA.id])
  })
})
