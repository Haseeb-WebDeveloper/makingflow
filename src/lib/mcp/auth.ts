import "server-only"

/**
 * API-key authentication for the MCP server.
 *
 * A key proves WHO is calling. It never decides WHAT they may do — that comes
 * from re-reading `workspace_members` on every request. The consequence is the
 * property that matters most here: remove someone from a workspace, or delete
 * their account, and their keys stop working on the very next call. No
 * revocation sweep, no cached role to go stale, no window where a demoted owner
 * still acts as one.
 *
 * The secret itself is never stored. `mcp_api_keys.key_hash` holds an HMAC of
 * it under APP_ENCRYPTION_KEY (see `hashApiKey`), so a SQL-level dump alone
 * yields nothing usable, and lookup is a single hit on that column's unique
 * index rather than a candidate scan.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpApiKeys, workspaceMembers, workspaces } from "@/lib/db/schema"
import { hashApiKey } from "@/lib/integrations/crypto"
import {
  isScope,
  unsafeSealContext,
  type AuthContext,
  type Role,
  type Scope,
} from "@/lib/auth/context"

/** Visible prefix, so a leaked key is recognisable in logs and search. */
const KEY_PREFIX = "mf_sk_live_"
/** 256 bits of CSPRNG. Not guessable, so the stored HMAC is a formality. */
const SECRET_BYTES = 32
/** How much of the token is stored in the clear, for the settings UI only. */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 4

export type MintedKey = {
  /** Shown to the user EXACTLY once and never persisted. */
  token: string
  keyHash: string
  prefix: string
}

/** Generate a fresh key. The caller stores `keyHash`/`prefix` and shows `token`. */
export function mintApiKey(): MintedKey {
  const token = KEY_PREFIX + randomBytes(SECRET_BYTES).toString("base64url")
  return {
    token,
    keyHash: hashApiKey(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  }
}

export type BearerFailure = {
  ok: false
  /** 401 = no/!valid credential. 403 = valid credential, insufficient access. */
  status: 401 | 403
  error: string
}
export type BearerResult = { ok: true; ctx: AuthContext } | BearerFailure

/** Pull the token out of an Authorization header, or null if there isn't one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  const [scheme, ...rest] = header.split(" ")
  if (scheme?.toLowerCase() !== "bearer") return null
  const token = rest.join(" ").trim()
  return token.length > 0 ? token : null
}

/**
 * Verify a presented key and build the caller's context.
 *
 * Note what is NOT read off the key row: the role. It is joined live from
 * `workspace_members`, so the key can never outrank — or outlive — the
 * membership behind it.
 */
export async function contextFromBearer(request: Request): Promise<BearerResult> {
  const token = bearerToken(request)
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" }
  if (!token.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, error: "Invalid API key" }
  }

  const presented = hashApiKey(token)

  // One indexed read that also joins the membership and the workspace, so a
  // valid-but-revoked membership costs no extra round-trip.
  const [row] = await db
    .select({
      keyId: mcpApiKeys.id,
      userId: mcpApiKeys.userId,
      workspaceId: mcpApiKeys.workspaceId,
      keyHash: mcpApiKeys.keyHash,
      scopes: mcpApiKeys.scopes,
      expiresAt: mcpApiKeys.expiresAt,
      revokedAt: mcpApiKeys.revokedAt,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      plan: workspaces.plan,
    })
    .from(mcpApiKeys)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, mcpApiKeys.workspaceId),
        eq(workspaceMembers.userId, mcpApiKeys.userId),
      ),
    )
    .leftJoin(workspaces, eq(workspaces.id, mcpApiKeys.workspaceId))
    .where(eq(mcpApiKeys.keyHash, presented))
    .limit(1)

  if (!row) return { ok: false, status: 401, error: "Invalid API key" }

  // The lookup already matched on the hash's unique index, so this is belt and
  // braces rather than the real check — but it costs nothing and keeps the
  // comparison constant-time regardless of how the row was found.
  const a = Buffer.from(row.keyHash)
  const b = Buffer.from(presented)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Invalid API key" }
  }

  if (row.revokedAt) return { ok: false, status: 401, error: "API key has been revoked" }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "API key has expired" }
  }

  // THE ACCESS CHECK. A key whose owner has left the workspace (or whose
  // account is gone) resolves to no membership row and stops working here.
  if (!row.role || !row.workspaceName || !row.plan) {
    return { ok: false, status: 403, error: "This key's workspace access has been removed" }
  }

  return {
    ok: true,
    ctx: unsafeSealContext({
      userId: row.userId,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      role: row.role as Role,
      plan: row.plan,
      scopes: new Set(row.scopes.filter(isScope)),
      origin: "api-key",
      apiKeyId: row.keyId,
      // Not a Server Action, so cache invalidation must go through
      // revalidateTag rather than updateTag. See src/lib/core/cache.ts.
      surface: "route-handler",
    }),
  }
}

/** Record that a key was used. Best-effort and off the hot path. */
export async function touchApiKey(keyId: string): Promise<void> {
  try {
    await db
      .update(mcpApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpApiKeys.id, keyId))
  } catch {
    // A failed bookkeeping write must never fail the tool call it describes.
  }
}

/**
 * The RFC 9728 challenge, returned even though v1 authenticates with a static
 * key. Clients already parse it, and emitting it now means the OAuth phase
 * changes nothing they can see.
 */
export function unauthorized(resourceMetadataUrl: string, scopes?: readonly Scope[]): Response {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl}"`]
  if (scopes?.length) parts.push(`scope="${scopes.join(" ")}"`)
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": parts.join(", ") } },
  )
}

/** 403 for a valid key that simply lacks the scope for what it asked to do. */
export function insufficientScope(
  resourceMetadataUrl: string,
  scopes: readonly Scope[],
  description: string,
): Response {
  const challenge = [
    'Bearer error="insufficient_scope"',
    `scope="${scopes.join(" ")}"`,
    `resource_metadata="${resourceMetadataUrl}"`,
    `error_description="${description.replace(/"/g, "'")}"`,
  ].join(", ")
  return Response.json(
    { error: "insufficient_scope", error_description: description },
    { status: 403, headers: { "WWW-Authenticate": challenge } },
  )
}
