import "server-only"

/**
 * API-key authentication for the MCP server.
 *
 * TWO THINGS, DELIBERATELY SEPARATE:
 *
 *   McpPrincipal — who is calling and what they were granted. Resolved once per
 *   request from the bearer token: the user, the key's scopes, and the
 *   workspaces it may reach.
 *
 *   AuthContext — which ONE workspace a given call acts on. Built per tool call
 *   from the principal. The core layer only ever sees this, so it stays exactly
 *   as simple as it was when a key meant one workspace.
 *
 * The split exists because every user in this product belongs to more than one
 * workspace. One key per workspace would mean registering the MCP server once
 * per workspace, with the client seeing every tool duplicated and unable to
 * answer anything spanning both.
 *
 * A key proves WHO is calling. It never decides WHAT they may do: the granted
 * workspace list is intersected with live `workspace_members` rows on every
 * request, so removing someone from a workspace cuts their key off on the very
 * next call, with no revocation sweep and no stale role cached anywhere. The
 * grant can lose reach; it can never gain it.
 *
 * The secret itself is never stored — `key_hash` is an HMAC of it under
 * APP_ENCRYPTION_KEY, so a SQL-level dump yields nothing usable, and lookup is
 * one hit on that column's unique index.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpApiKeys, mcpKeyWorkspaces, workspaceMembers, workspaces } from "@/lib/db/schema"
import { hashApiKey } from "@/lib/integrations/crypto"
import {
  isScope,
  unsafeSealContext,
  type AuthContext,
  type Role,
  type Scope,
} from "@/lib/auth/context"
import { canonicalResource } from "@/lib/mcp/metadata"
import { oauthConfig } from "@/lib/mcp/oauth/config"
import { verifyAccessToken } from "@/lib/mcp/oauth/verify"
import { grantForToken } from "@/lib/mcp/oauth/grants"

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

/** One workspace this key may act on, with the caller's live role in it. */
export type GrantedWorkspace = {
  id: string
  name: string
  role: Role
  plan: string
}

/**
 * Which credential a request arrived on.
 *
 * Two paths exist because two families of client exist. Claude Code, Cursor and
 * VS Code let a user set an Authorization header, so a long-lived key is the
 * simplest thing that works. ChatGPT and claude.ai authenticate connectors only
 * through OAuth and have no header field anywhere in their UI — so that is not a
 * nicer version of the same door, it is the only door those clients can use.
 *
 * Past this point the two are indistinguishable. Both resolve to the same
 * principal, both intersect their grant with live membership, and every tool
 * sees the same AuthContext. The credential decides who is calling; it has never
 * decided what they may do.
 */
export type Credential =
  | { kind: "api-key"; apiKeyId: string }
  | { kind: "oauth"; grantId: string; clientId: string }

export type McpPrincipal = {
  userId: string
  credential: Credential
  scopes: ReadonlySet<Scope>
  /** Granted ∩ still-a-member. Never empty — an empty result is a 403. */
  workspaces: GrantedWorkspace[]
}

/** The key id, when this principal came from one. Null for an OAuth caller. */
export function apiKeyIdOf(principal: McpPrincipal): string | null {
  return principal.credential.kind === "api-key" ? principal.credential.apiKeyId : null
}

/** The grant id, when this principal came from one. Null for a key. */
export function grantIdOf(principal: McpPrincipal): string | null {
  return principal.credential.kind === "oauth" ? principal.credential.grantId : null
}

export type BearerFailure = {
  ok: false
  /** 401 = no/invalid credential. 403 = valid credential, insufficient access. */
  status: 401 | 403
  error: string
}
export type PrincipalResult = { ok: true; principal: McpPrincipal } | BearerFailure

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
 * Verify whatever credential was presented and resolve what it can reach.
 *
 * The two token families are told apart by our own prefix, not by guessing: a
 * key always starts `mf_sk_live_`, so anything else is offered to the OAuth
 * verifier. That ordering matters — trying to parse a key as a JWT produces a
 * confusing "signature invalid" where "invalid API key" is the truth.
 *
 * When OAuth is not configured, a non-key token is refused as a bad key, which
 * is exactly what it is on such a deployment.
 */
export async function principalFromBearer(request: Request): Promise<PrincipalResult> {
  const token = bearerToken(request)
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" }
  if (!token.startsWith(KEY_PREFIX)) {
    return principalFromOauthToken(token, request)
  }

  const presented = hashApiKey(token)

  const [key] = await db
    .select({
      id: mcpApiKeys.id,
      userId: mcpApiKeys.userId,
      keyHash: mcpApiKeys.keyHash,
      scopes: mcpApiKeys.scopes,
      expiresAt: mcpApiKeys.expiresAt,
      revokedAt: mcpApiKeys.revokedAt,
    })
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.keyHash, presented))
    .limit(1)

  if (!key) return { ok: false, status: 401, error: "Invalid API key" }

  // The lookup already matched the hash's unique index, so this is belt and
  // braces — but it costs nothing and keeps the comparison constant-time.
  const a = Buffer.from(key.keyHash)
  const b = Buffer.from(presented)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Invalid API key" }
  }

  if (key.revokedAt) return { ok: false, status: 401, error: "API key has been revoked" }
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "API key has expired" }
  }

  const granted = await db
    .select({ workspaceId: mcpKeyWorkspaces.workspaceId })
    .from(mcpKeyWorkspaces)
    .where(eq(mcpKeyWorkspaces.keyId, key.id))
  if (granted.length === 0) {
    return { ok: false, status: 403, error: "This key grants access to no workspace" }
  }

  // THE ACCESS CHECK. The grant is intersected with live membership, so a
  // workspace the user has since left drops out here rather than being trusted
  // because it was granted once.
  const reachable = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      plan: workspaces.plan,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, key.userId),
        inArray(
          workspaceMembers.workspaceId,
          granted.map((g) => g.workspaceId),
        ),
      ),
    )

  if (reachable.length === 0) {
    return { ok: false, status: 403, error: "This key's workspace access has been removed" }
  }

  return {
    ok: true,
    principal: {
      userId: key.userId,
      credential: { kind: "api-key", apiKeyId: key.id },
      scopes: new Set(key.scopes.filter(isScope)),
      workspaces: reachable.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role as Role,
        plan: w.plan,
      })),
    },
  }
}

/**
 * The OAuth half: verify the JWT, then resolve the consent behind it.
 *
 * Deliberately two steps with two different owners. The token is checked against
 * the authorization server's keys and, critically, against OUR audience — see
 * oauth/verify.ts. What that verified identity may then reach is answered
 * entirely from our own tables, so no vendor needs to model our permissions and
 * a token minted last week cannot outrun a membership change made this morning.
 */
async function principalFromOauthToken(
  token: string,
  request: Request,
): Promise<PrincipalResult> {
  const config = oauthConfig(canonicalResource(request))
  if (!config) {
    // No authorization server on this deployment, so a non-key token is simply
    // not a credential here. Reported as a bad key rather than as an OAuth
    // failure, because there is no OAuth to have failed.
    return { ok: false, status: 401, error: "Invalid API key" }
  }

  const verified = await verifyAccessToken(token, config)
  if (!verified.ok) return { ok: false, status: 401, error: verified.error }

  const resolved = await grantForToken(verified.token)
  if (!resolved.ok) return resolved

  return {
    ok: true,
    principal: {
      userId: resolved.grant.userId,
      credential: {
        kind: "oauth",
        grantId: resolved.grant.grantId,
        clientId: verified.token.clientId,
      },
      scopes: resolved.grant.scopes,
      workspaces: resolved.grant.workspaces,
    },
  }
}

export type WorkspaceChoice =
  | { ok: true; ctx: AuthContext }
  | { ok: false; error: string }

/**
 * Narrow a principal to the one workspace a call acts on.
 *
 * With a single granted workspace the argument is unnecessary and ignored —
 * there is nothing to choose. With several it is required, and an id outside
 * the grant is refused with the same message as one that does not exist, so the
 * API never confirms a workspace the caller cannot see.
 */
export function contextForWorkspace(
  principal: McpPrincipal,
  workspaceId?: string,
): WorkspaceChoice {
  // An explicitly named workspace is ALWAYS looked up in the grant, never
  // defaulted away. Falling back to "the only one" when a caller named a
  // different one is how a stale client ends up writing to the wrong workspace
  // without anything reporting a problem.
  const target = workspaceId
    ? principal.workspaces.find((w) => w.id === workspaceId)
    : principal.workspaces.length === 1
      ? principal.workspaces[0]
      : undefined

  if (!target) {
    return {
      ok: false,
      error: workspaceId
        ? "Workspace not found"
        : `This key covers ${principal.workspaces.length} workspaces — pass workspaceId. Available: ${principal.workspaces
            .map((w) => `${w.name} (${w.id})`)
            .join(", ")}`,
    }
  }

  return {
    ok: true,
    ctx: unsafeSealContext({
      userId: principal.userId,
      workspaceId: target.id,
      workspaceName: target.name,
      role: target.role,
      plan: target.plan,
      scopes: principal.scopes,
      // Both credentials are delegated, and core treats them identically. The
      // distinction that matters downstream is session-vs-delegated, not which
      // kind of delegation — so it stays "api-key" rather than fanning out a
      // second value every consumer would have to learn to handle the same way.
      origin: "api-key",
      apiKeyId: apiKeyIdOf(principal),
      grantId: grantIdOf(principal),
      // Not a Server Action, so cache invalidation must go through
      // revalidateTag rather than updateTag. See src/lib/core/cache.ts.
      surface: "route-handler",
    }),
  }
}

/** Record that a key was used. Best-effort and off the hot path. */
export async function touchApiKey(keyId: string): Promise<void> {
  try {
    await db.update(mcpApiKeys).set({ lastUsedAt: new Date() }).where(eq(mcpApiKeys.id, keyId))
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
