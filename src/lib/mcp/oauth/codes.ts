import "server-only"

/**
 * Authorization codes, and the PKCE check that makes them safe to hand out.
 *
 * Everything here assumes THE CODE LEAKS. It travels back to the client in a URL
 * — through the browser's address bar, its history, a referrer header, a
 * screenshot, an over-the-shoulder glance. Treating it as a secret would be
 * wishful; instead it is made worthless to anyone but its requester.
 *
 * Three independent things do that:
 *
 *   1. PKCE. The client invents a random `code_verifier`, sends us only its
 *      SHA-256 hash up front, and must produce the original at redemption. An
 *      attacker holding a stolen code has the hash — which is exactly as useful
 *      as a hash ever is. This is what replaces a client secret for software
 *      that cannot keep one.
 *   2. One minute to live, and single use.
 *   3. Bound to the client and the exact redirect URI it was issued for, both
 *      re-checked at redemption.
 *
 * REPLAY IS TREATED AS THEFT. A redeemed code is marked, not deleted, so a
 * second attempt is visible. When one arrives, the honest reading is that the
 * code reached two parties — so every token descended from it is revoked, per
 * OAuth 2.1 §4.1.3. That is deliberately harsher than refusing the second
 * request: refusing it alone would leave whichever party redeemed FIRST — quite
 * possibly the attacker — holding live tokens.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, isNull, lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpOauthCodes, mcpOauthTokens } from "@/lib/db/schema"
import { hashApiKey } from "@/lib/integrations/crypto"

/** Long enough for a browser redirect, short enough to be useless if logged. */
const CODE_TTL_MS = 60_000

export type IssuedCode = { code: string; expiresAt: Date }

export type CodeGrantDetails = {
  grantId: string
  clientId: string
  resource: string | null
}

export type RedemptionResult =
  | { ok: true; grant: CodeGrantDetails }
  | { ok: false; error: string; description: string }

/**
 * The PKCE transform: BASE64URL(SHA256(verifier)).
 *
 * Only S256 is supported. OAuth 2.1 removes `plain`, and rightly — a `plain`
 * challenge is the verifier itself, so anyone who saw the authorization request
 * can redeem the code, which is the whole attack PKCE exists to stop.
 */
function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function issueCodeValue(): string {
  return randomBytes(32).toString("base64url")
}

/** Record a code for a consented grant, and return the value to redirect with. */
export async function createAuthorizationCode(input: {
  grantId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  resource: string | null
  now?: Date
}): Promise<IssuedCode> {
  const now = input.now ?? new Date()
  const code = issueCodeValue()
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS)

  await db.insert(mcpOauthCodes).values({
    codeHash: hashApiKey(code),
    clientId: input.clientId,
    grantId: input.grantId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
    expiresAt,
  })

  // Opportunistic tidy-up, mirroring the rate limiter: no cron pattern exists in
  // this repo, and expired codes are dead weight the moment they lapse.
  void sweepExpiredCodes()

  return { code, expiresAt }
}

/**
 * Redeem a code, or explain why not.
 *
 * The refusals are deliberately uniform — "invalid_grant" with a vague
 * description — because distinguishing "no such code" from "wrong client" from
 * "wrong verifier" tells an attacker which half of their guess was right.
 */
export async function redeemAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
  now?: Date
}): Promise<RedemptionResult> {
  const now = input.now ?? new Date()
  const invalid = {
    ok: false as const,
    error: "invalid_grant",
    description: "The authorization code is invalid, expired, or already used.",
  }

  const codeHash = hashApiKey(input.code)
  const [row] = await db
    .select()
    .from(mcpOauthCodes)
    .where(eq(mcpOauthCodes.codeHash, codeHash))
    .limit(1)
  if (!row) return invalid

  // REPLAY. The code reached two parties; we cannot tell which is legitimate,
  // so neither keeps anything. Revoking descendants is the point — refusing
  // only this request would leave whoever redeemed first holding live tokens.
  if (row.usedAt) {
    await db
      .update(mcpOauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(mcpOauthTokens.grantId, row.grantId), isNull(mcpOauthTokens.revokedAt)))
    console.warn("[mcp/oauth] authorization code replayed; revoked tokens for grant", row.grantId)
    return invalid
  }

  if (row.expiresAt.getTime() <= now.getTime()) return invalid
  if (row.clientId !== input.clientId) return invalid
  // Re-checked, not assumed: a code issued for one destination must not be
  // redeemable against another.
  if (row.redirectUri !== input.redirectUri) return invalid

  // The PKCE check itself. Constant-time, because this compares a secret.
  const expected = Buffer.from(row.codeChallenge)
  const actual = Buffer.from(s256(input.codeVerifier))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return invalid

  // Mark used BEFORE issuing anything, and only if it is still unused — so two
  // simultaneous redemptions cannot both succeed.
  const claimed = await db
    .update(mcpOauthCodes)
    .set({ usedAt: now })
    .where(and(eq(mcpOauthCodes.codeHash, codeHash), isNull(mcpOauthCodes.usedAt)))
    .returning({ codeHash: mcpOauthCodes.codeHash })
  if (claimed.length === 0) return invalid

  return {
    ok: true,
    grant: { grantId: row.grantId, clientId: row.clientId, resource: row.resource },
  }
}

/**
 * Validate a `code_challenge` before we ever redirect.
 *
 * RFC 7636 fixes the verifier at 43–128 characters of unreserved alphabet; the
 * challenge is its base64url digest, so 43 characters exactly.
 */
export function isValidCodeChallenge(challenge: string | null, method: string | null): boolean {
  if (!challenge) return false
  // `plain` is removed in OAuth 2.1 and must not be silently accepted.
  if (method !== "S256") return false
  return /^[A-Za-z0-9\-._~]{43}$/.test(challenge)
}

/** Delete codes whose window has closed. Best-effort, off the response path. */
async function sweepExpiredCodes(): Promise<void> {
  try {
    // A short grace period keeps a just-expired row around long enough for the
    // replay check above to still see it.
    const cutoff = new Date(Date.now() - 10 * 60_000)
    await db.delete(mcpOauthCodes).where(lt(mcpOauthCodes.expiresAt, cutoff))
  } catch (error) {
    console.error("[mcp/oauth] code sweep failed", error)
  }
}
