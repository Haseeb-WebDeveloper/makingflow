import "server-only"

/**
 * Access and refresh tokens.
 *
 * OPAQUE, not JWTs, and that is the interesting decision here.
 *
 * A signed token exists so that a resource server can verify a credential
 * WITHOUT asking the issuer — worth real complexity when those are different
 * companies. Here they are the same request handler. The signature would buy
 * nothing and cost key management, key rotation, and an audience check that is
 * easy to get subtly wrong (it is precisely what disqualified a hosted
 * authorization server earlier in this project).
 *
 * What we get instead is better revocation. A JWT is valid until it expires, so
 * "disconnect this app" really means "disconnect it within the hour". A row
 * lookup means the very next request fails, which is what a user pressing
 * Disconnect believes is happening.
 *
 * Tokens are stored as HMACs, exactly like API keys: a database dump yields
 * nothing redeemable, and lookup is one hit on the primary key.
 *
 * REFRESH ROTATION. Every refresh issues a new pair and revokes the presented
 * token. A stolen refresh token is therefore good for at most one use, and — the
 * real prize — reuse of an already-rotated token is loud evidence of theft, so
 * it revokes the whole family rather than merely failing.
 */

import { randomBytes } from "node:crypto"
import { and, eq, isNull, lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpOauthTokens } from "@/lib/db/schema"
import { hashApiKey } from "@/lib/integrations/crypto"

/**
 * Short, because rotation is cheap and a leaked access token's blast radius is
 * bounded by this number. Long enough that a working session is not a stream of
 * refreshes.
 */
const ACCESS_TTL_MS = 60 * 60 * 1000
/** Long-lived: this is what keeps a connected app connected. */
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Recognisable in a log or a support ticket without being guessable. */
const ACCESS_PREFIX = "mf_at_"
const REFRESH_PREFIX = "mf_rt_"

export type TokenPair = {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
}

function mint(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url")
}

/** Issue a fresh pair for a grant. */
export async function issueTokenPair(
  grantId: string,
  options: { replaces?: string | null; now?: Date } = {},
): Promise<TokenPair> {
  const now = options.now ?? new Date()
  const accessToken = mint(ACCESS_PREFIX)
  const refreshToken = mint(REFRESH_PREFIX)

  await db.insert(mcpOauthTokens).values([
    {
      tokenHash: hashApiKey(accessToken),
      grantId,
      kind: "access",
      expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    },
    {
      tokenHash: hashApiKey(refreshToken),
      grantId,
      kind: "refresh",
      replacesTokenHash: options.replaces ?? null,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  ])

  void sweepExpiredTokens()

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000),
  }
}

export type AccessTokenLookup =
  | { ok: true; grantId: string }
  | { ok: false; error: string }

/**
 * Resolve a presented access token to the grant behind it.
 *
 * Says only which grant. What that grant may reach is answered separately, from
 * live membership — see grants.ts. Keeping those apart is what stops a token
 * from outliving a permission change.
 */
export async function accessTokenGrant(
  token: string,
  now = new Date(),
): Promise<AccessTokenLookup> {
  if (!token.startsWith(ACCESS_PREFIX)) return { ok: false, error: "Invalid access token" }

  const [row] = await db
    .select({
      grantId: mcpOauthTokens.grantId,
      kind: mcpOauthTokens.kind,
      expiresAt: mcpOauthTokens.expiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
    })
    .from(mcpOauthTokens)
    .where(eq(mcpOauthTokens.tokenHash, hashApiKey(token)))
    .limit(1)

  if (!row || row.kind !== "access") return { ok: false, error: "Invalid access token" }
  if (row.revokedAt) return { ok: false, error: "Access token has been revoked" }
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Named precisely: a client that knows the token merely expired refreshes,
    // where "invalid" would send it back through the whole consent flow.
    return { ok: false, error: "Access token has expired" }
  }

  return { ok: true, grantId: row.grantId }
}

export type RefreshResult =
  | { ok: true; grantId: string; tokens: TokenPair }
  | { ok: false; error: string; description: string }

/** Exchange a refresh token for a new pair, revoking the one presented. */
export async function rotateRefreshToken(
  token: string,
  now = new Date(),
): Promise<RefreshResult> {
  const invalid = {
    ok: false as const,
    error: "invalid_grant",
    description: "The refresh token is invalid, expired, or already used.",
  }
  if (!token.startsWith(REFRESH_PREFIX)) return invalid

  const tokenHash = hashApiKey(token)
  const [row] = await db
    .select({
      grantId: mcpOauthTokens.grantId,
      kind: mcpOauthTokens.kind,
      expiresAt: mcpOauthTokens.expiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
    })
    .from(mcpOauthTokens)
    .where(eq(mcpOauthTokens.tokenHash, tokenHash))
    .limit(1)

  if (!row || row.kind !== "refresh") return invalid

  // REUSE OF A ROTATED TOKEN. Either it leaked, or a client is retrying badly.
  // We cannot tell, and only one of those is survivable — so the whole family
  // goes. OAuth 2.1 §4.3.1.
  if (row.revokedAt) {
    await revokeGrantTokens(row.grantId, now)
    console.warn("[mcp/oauth] refresh token reused; revoked all tokens for grant", row.grantId)
    return invalid
  }

  if (row.expiresAt.getTime() <= now.getTime()) return invalid

  // Claim it first, and only if still live, so two concurrent refreshes cannot
  // both mint a pair.
  const claimed = await db
    .update(mcpOauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(mcpOauthTokens.tokenHash, tokenHash), isNull(mcpOauthTokens.revokedAt)))
    .returning({ tokenHash: mcpOauthTokens.tokenHash })
  if (claimed.length === 0) return invalid

  const tokens = await issueTokenPair(row.grantId, { replaces: tokenHash, now })
  return { ok: true, grantId: row.grantId, tokens }
}

/**
 * Kill every live token for a grant.
 *
 * Called when a user disconnects an app, and when we detect a replayed code or
 * a reused refresh token. This is what makes Disconnect mean what it says.
 */
export async function revokeGrantTokens(grantId: string, now = new Date()): Promise<void> {
  await db
    .update(mcpOauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(mcpOauthTokens.grantId, grantId), isNull(mcpOauthTokens.revokedAt)))
}

/**
 * Revoke a single token by value (RFC 7009).
 *
 * Revoking a refresh token takes its whole grant with it, which is what a client
 * calling this on sign-out means: the user is disconnecting, not tidying up one
 * credential. Revoking an access token affects only that token.
 */
export async function revokeToken(token: string, now = new Date()): Promise<void> {
  const tokenHash = hashApiKey(token)
  const [row] = await db
    .select({ grantId: mcpOauthTokens.grantId, kind: mcpOauthTokens.kind })
    .from(mcpOauthTokens)
    .where(eq(mcpOauthTokens.tokenHash, tokenHash))
    .limit(1)
  if (!row) return

  if (row.kind === "refresh") {
    await revokeGrantTokens(row.grantId, now)
    return
  }
  await db
    .update(mcpOauthTokens)
    .set({ revokedAt: now })
    .where(eq(mcpOauthTokens.tokenHash, tokenHash))
}

/** Drop long-dead rows. Best-effort, off the response path. */
async function sweepExpiredTokens(): Promise<void> {
  try {
    // Well past expiry, so a client presenting a stale token still gets
    // "expired" rather than the blanker "invalid".
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    await db.delete(mcpOauthTokens).where(lt(mcpOauthTokens.expiresAt, cutoff))
  } catch (error) {
    console.error("[mcp/oauth] token sweep failed", error)
  }
}
