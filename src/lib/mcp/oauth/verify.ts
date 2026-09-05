import "server-only"

/**
 * Verifying an access token from the authorization server.
 *
 * FOUR CHECKS, and the third is the one that matters.
 *
 *   1. Signature, against the issuer's published JWKS. Nothing else runs until
 *      this passes.
 *   2. Issuer, exactly equal to the configured one.
 *   3. AUDIENCE, exactly equal to our canonical resource URL. This is what stops
 *      a token minted for a different resource on the SAME authorization server
 *      from working here. Without it, any client registered on the project holds
 *      a credential for our data — the confused-deputy problem RFC 8707 exists
 *      to close, and the specific reason a hosted AS without audience binding
 *      was not usable for this.
 *   4. Expiry, with no clock skew allowance. `jose` enforces `exp` and `nbf`.
 *
 * WHAT THE TOKEN IS NOT ASKED TO CARRY. Not scopes, not workspaces, not a role.
 * It answers exactly two questions — which user, and which client — and our own
 * grant table answers the rest. That is deliberate: a token is a snapshot taken
 * at consent, and a snapshot of authority goes stale. Someone removed from a
 * workspace this morning still holds a perfectly valid token minted last week,
 * so authority has to be re-read per request from rows we control. It also means
 * no authorization server needs to model our eight scopes to be usable here,
 * which is what made the vendor choice reversible.
 *
 * The JWKS is cached and re-fetched on unknown `kid` (jose's `createRemoteJWKSet`
 * handles both), so key rotation heals itself without a deploy — and a single
 * bad token cannot make us hammer the issuer, because jose rate-limits the
 * refresh internally.
 */

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose"
import type { OauthConfig } from "@/lib/mcp/oauth/config"

/** What a verified token tells us. Everything else comes from our own tables. */
export type VerifiedToken = {
  /** The AS's identifier for the human. Matched to `users.id` via the login URI. */
  subject: string
  /** The OAuth client. Compared against the grant, so one client's token cannot
   *  ride on another's consent. */
  clientId: string
  expiresAt: Date
}

export type TokenFailure = { ok: false; error: string }
export type TokenResult = { ok: true; token: VerifiedToken } | TokenFailure

/**
 * One JWKS per issuer, kept across requests.
 *
 * A module-level cache rather than a per-call fetch: on serverless this is per
 * instance, which is the right granularity — a warm instance reuses keys, a cold
 * one pays one fetch. Keyed by URI so changing the issuer in configuration takes
 * effect without a stale key set surviving.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwks(config: OauthConfig) {
  let set = jwksCache.get(config.jwksUri)
  if (!set) {
    set = createRemoteJWKSet(new URL(config.jwksUri), {
      // A hung issuer must not hold a tool call open until the platform kills
      // it. Failing fast produces a 401 the client can act on.
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    })
    jwksCache.set(config.jwksUri, set)
  }
  return set
}

export async function verifyAccessToken(
  token: string,
  config: OauthConfig,
): Promise<TokenResult> {
  try {
    const { payload } = await jwtVerify(token, jwks(config), {
      issuer: config.issuer,
      // THE AUDIENCE CHECK. jose compares against every value of `aud`, string
      // or array, and throws when none matches.
      audience: config.audience,
      // No tolerance: a token that expired is expired. Clock skew between us and
      // the issuer is a deployment problem, not something to paper over by
      // honouring dead credentials.
      clockTolerance: 0,
    })

    const subject = typeof payload.sub === "string" ? payload.sub : null
    if (!subject) return { ok: false, error: "Token has no subject" }

    // `client_id` is what binds a token to the consent that authorised it. A
    // token without one cannot be matched to a grant, so it is refused rather
    // than falling back to "any grant this user has" — which would let one
    // connected app act through another's permissions.
    const clientId = typeof payload.client_id === "string" ? payload.client_id : null
    if (!clientId) return { ok: false, error: "Token names no client" }

    if (typeof payload.exp !== "number") return { ok: false, error: "Token has no expiry" }

    return {
      ok: true,
      token: { subject, clientId, expiresAt: new Date(payload.exp * 1000) },
    }
  } catch (error) {
    // The client is told which of these it was, because each has a different
    // fix: refresh, re-authorise, or "you are pointed at the wrong server".
    if (error instanceof joseErrors.JWTExpired) {
      return { ok: false, error: "Access token has expired" }
    }
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      return {
        ok: false,
        error:
          error.claim === "aud"
            ? "Access token was not issued for this server"
            : `Access token failed validation (${error.claim})`,
      }
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { ok: false, error: "Access token signature is invalid" }
    }
    // A JWKS fetch failure is OUR outage, not the caller's fault — log it, since
    // otherwise it looks like every client suddenly presenting bad tokens.
    console.error("[mcp/oauth] token verification failed", error)
    return { ok: false, error: "Could not verify the access token" }
  }
}

/** Test seam: drop cached key sets so a test can point at a new issuer. */
export function resetJwksCache(): void {
  jwksCache.clear()
}
