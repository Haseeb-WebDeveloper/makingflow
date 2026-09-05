/**
 * Minting, listing and revoking MCP API keys.
 *
 * Shared by the /integrations UI, the `pnpm mcp:key` CLI and the tests, so a
 * key made any of those ways is identical.
 *
 * WHO MAY MINT: owners only. Nothing in the app's permission model previously
 * covered this, so the choice is worth stating. A key can read every response
 * in every workspace it is granted — CVs, email addresses, phone numbers — and
 * it keeps working from anywhere until revoked. That is the same weight as
 * inviting a teammate, which is already owner-only, so it is gated on the same
 * `manage_team` action rather than inventing a parallel rule.
 *
 * Members are not locked out of their own credentials: they can see and revoke
 * keys they created. They just cannot issue new ones.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpApiKeys, mcpKeyWorkspaces, workspaceMembers, workspaces } from "@/lib/db/schema"
import { authorize, isScope, type AuthContext, type Scope } from "@/lib/auth/context"
import { mintApiKey } from "@/lib/mcp/auth"

export type KeySummary = {
  id: string
  name: string
  /** "mf_sk_live_a1b2" — enough to recognise, useless as a credential. */
  prefix: string
  scopes: Scope[]
  workspaces: { id: string; name: string }[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  /** Whether the caller created this one; members may only revoke their own. */
  mine: boolean
}

export type CreateKeyResult =
  | {
      success: true
      /** Shown ONCE. The database holds only an HMAC, so this is unrecoverable. */
      token: string
      key: KeySummary
    }
  | { success: false; error: string }

export type Result = { success: true } | { success: false; error: string }

const MAX_KEYS_PER_USER = 20

/** Every key the caller may see: theirs, plus all of them if they are an owner. */
export async function listKeys(ctx: AuthContext): Promise<KeySummary[]> {
  // Scoped by workspace, not by user: a key is listed on the /integrations page
  // of every workspace it can reach, so an owner can audit what has access to
  // the workspace they are looking at.
  const grantedHere = db
    .select({ keyId: mcpKeyWorkspaces.keyId })
    .from(mcpKeyWorkspaces)
    .where(eq(mcpKeyWorkspaces.workspaceId, ctx.workspaceId))

  const rows = await db
    .select({
      id: mcpApiKeys.id,
      name: mcpApiKeys.name,
      prefix: mcpApiKeys.prefix,
      scopes: mcpApiKeys.scopes,
      userId: mcpApiKeys.userId,
      createdAt: mcpApiKeys.createdAt,
      lastUsedAt: mcpApiKeys.lastUsedAt,
      expiresAt: mcpApiKeys.expiresAt,
    })
    .from(mcpApiKeys)
    .where(and(inArray(mcpApiKeys.id, grantedHere), isNull(mcpApiKeys.revokedAt)))
    .orderBy(desc(mcpApiKeys.createdAt))

  if (rows.length === 0) return []

  const grants = await db
    .select({
      keyId: mcpKeyWorkspaces.keyId,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(mcpKeyWorkspaces)
    .innerJoin(workspaces, eq(workspaces.id, mcpKeyWorkspaces.workspaceId))
    .where(
      inArray(
        mcpKeyWorkspaces.keyId,
        rows.map((r) => r.id),
      ),
    )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes.filter(isScope),
    workspaces: grants
      .filter((g) => g.keyId === r.id)
      .map((g) => ({ id: g.workspaceId, name: g.workspaceName })),
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    mine: r.userId === ctx.userId,
  }))
}

/** Workspaces the caller could grant a key — exactly their own memberships. */
export async function grantableWorkspaces(
  ctx: AuthContext,
): Promise<{ id: string; name: string; role: string }[]> {
  return db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, ctx.userId))
    .orderBy(workspaces.name)
}

export async function createKey(
  ctx: AuthContext,
  input: { name: string; scopes: string[]; workspaceIds: string[]; expiresInDays?: number | null },
): Promise<CreateKeyResult> {
  const denied = authorize(ctx, { action: "manage_team" })
  if (denied) return { success: false, error: "Only owners can create API keys" }

  const name = input.name.trim().slice(0, 80)
  if (!name) return { success: false, error: "Give the key a name so you can recognise it later." }

  const scopes = input.scopes.filter(isScope)
  if (scopes.length === 0) return { success: false, error: "Choose at least one permission." }

  if (input.workspaceIds.length === 0) {
    return { success: false, error: "Choose at least one workspace." }
  }

  // A key may only reach workspaces the CALLER is a member of. Without this,
  // any workspace id posted from the browser would be granted — the request
  // body is not a trust boundary.
  const allowed = await grantableWorkspaces(ctx)
  const allowedIds = new Set(allowed.map((w) => w.id))
  const requested = [...new Set(input.workspaceIds)]
  if (requested.some((id) => !allowedIds.has(id))) {
    return { success: false, error: "You can only grant access to workspaces you belong to." }
  }

  // A cap, so a runaway script cannot fill the table with credentials that all
  // keep working.
  const existing = await db
    .select({ id: mcpApiKeys.id })
    .from(mcpApiKeys)
    .where(and(eq(mcpApiKeys.userId, ctx.userId), isNull(mcpApiKeys.revokedAt)))
  if (existing.length >= MAX_KEYS_PER_USER) {
    return {
      success: false,
      error: `You already have ${MAX_KEYS_PER_USER} active keys. Revoke one before creating another.`,
    }
  }

  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null

  const { token, keyHash, prefix } = mintApiKey()

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(mcpApiKeys)
      .values({ userId: ctx.userId, name, prefix, keyHash, scopes, expiresAt })
      .returning({ id: mcpApiKeys.id, createdAt: mcpApiKeys.createdAt })
    await tx
      .insert(mcpKeyWorkspaces)
      .values(requested.map((workspaceId) => ({ keyId: row.id, workspaceId })))
    return row
  })

  const names = new Map(allowed.map((w) => [w.id, w.name]))
  return {
    success: true,
    token,
    key: {
      id: created.id,
      name,
      prefix,
      scopes,
      workspaces: requested.map((id) => ({ id, name: names.get(id) ?? "" })),
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: null,
      expiresAt: expiresAt?.toISOString() ?? null,
      mine: true,
    },
  }
}

/**
 * Revoke a key. Takes effect on its very next request — verification checks
 * `revokedAt` every time, so there is no window and no sweep to run.
 */
export async function revokeKey(ctx: AuthContext, keyId: string): Promise<Result> {
  // The key must be reachable from THIS workspace, or one workspace's owner
  // could revoke a credential belonging to a workspace they cannot see.
  const [grant] = await db
    .select({ keyId: mcpKeyWorkspaces.keyId })
    .from(mcpKeyWorkspaces)
    .where(
      and(
        eq(mcpKeyWorkspaces.keyId, keyId),
        eq(mcpKeyWorkspaces.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1)
  if (!grant) return { success: false, error: "Key not found" }

  const [key] = await db
    .select({ userId: mcpApiKeys.userId })
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.id, keyId))
    .limit(1)
  if (!key) return { success: false, error: "Key not found" }

  // Owners may revoke anything reaching their workspace; members only their own.
  const isOwner = !authorize(ctx, { action: "manage_team" })
  if (!isOwner && key.userId !== ctx.userId) {
    return { success: false, error: "You can only revoke keys you created" }
  }

  await db.update(mcpApiKeys).set({ revokedAt: new Date() }).where(eq(mcpApiKeys.id, keyId))
  return { success: true }
}
