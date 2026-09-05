/**
 * Access-token verification, with a real signing key and a real JWKS.
 *
 * The audience check is the reason this file exists. Everything else here —
 * signature, issuer, expiry — is `jose` doing its job, and worth one test each
 * to prove it is actually switched on. The audience is OURS to get right, and
 * getting it wrong is not a subtle bug: a hosted authorization server issues
 * tokens for many resources, so without `aud` pinned to our canonical URL, a
 * token minted for ANY other client on the same project would verify here and
 * hold a working credential for our customers' data. That is the confused-deputy
 * problem RFC 8707 exists to close, and it fails silently — every test that does
 * not assert it passes just as happily.
 *
 * The trap worth naming: the `resource` parameter round-trips cleanly through
 * an authorization server that does not implement RFC 8707 at all. Integration
 * testing looks like it works right up until you decode a token and check `aud`.
 */

import { beforeAll, describe, expect, test } from "vitest"
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose"
import { resetJwksCache, verifyAccessToken } from "@/lib/mcp/oauth/verify"
import type { OauthConfig } from "@/lib/mcp/oauth/config"

const ISSUER = "https://as.example.test"
const AUDIENCE = "https://makingflow.example.test/api/mcp"

let privateKey: CryptoKey
let publicJwk: JWK

/**
 * Serve the JWKS from a stubbed fetch.
 *
 * `createRemoteJWKSet` fetches over HTTP, so the alternative is a real server on
 * a real port — slower, flakier, and proving nothing extra. What matters is that
 * jose is handed genuine keys and does genuine crypto, which it is.
 */
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true })
  privateKey = pair.privateKey
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" }

  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(ISSUER)) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return realFetch(input as RequestInfo, init)
  }) as typeof fetch
})

const config: OauthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: `${ISSUER}/oauth2/jwks`,
}

async function mint(
  claims: Record<string, unknown> = {},
  { issuer = ISSUER, audience = AUDIENCE, expiresIn = "10m", key = privateKey } = {},
): Promise<string> {
  return new SignJWT({ client_id: "client_abc", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("11111111-1111-1111-1111-111111111111")
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key)
}

describe("verifyAccessToken", () => {
  beforeAll(() => resetJwksCache())

  test("accepts a well-formed token and returns only what it should", async () => {
    const result = await verifyAccessToken(await mint(), config)
    if (!result.ok) throw new Error(result.error)

    expect(result.token.subject).toBe("11111111-1111-1111-1111-111111111111")
    expect(result.token.clientId).toBe("client_abc")
    expect(result.token.expiresAt.getTime()).toBeGreaterThan(Date.now())
    // Nothing else is extracted. Scopes and workspaces come from OUR tables, so
    // a token that carried them would not be believed anyway.
    expect(Object.keys(result.token).sort()).toEqual(["clientId", "expiresAt", "subject"])
  })

  describe("the audience check", () => {
    test("refuses a token minted for a different resource", async () => {
      // The whole point. Same issuer, same signing key, valid in every other
      // respect — and it must not work here.
      const result = await verifyAccessToken(
        await mint({}, { audience: "https://someone-else.example/api/mcp" }),
        config,
      )
      expect(result).toEqual({
        ok: false,
        error: "Access token was not issued for this server",
      })
    })

    test("refuses a token with no audience at all", async () => {
      const token = await new SignJWT({ client_id: "client_abc" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject("user")
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey)

      const result = await verifyAccessToken(token, config)
      expect(result.ok).toBe(false)
    })

    test("accepts when our resource is one of several audiences", async () => {
      // Legitimate: an AS may bind a token to more than one resource. jose
      // matches against every entry, and so must we.
      const token = await new SignJWT({ client_id: "client_abc" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject("user")
        .setIssuer(ISSUER)
        .setAudience(["https://other.example/api", AUDIENCE])
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey)

      expect((await verifyAccessToken(token, config)).ok).toBe(true)
    })

    test("a trailing slash is a different resource", async () => {
      // `aud` is compared as an exact string, so `/api/mcp/` is not `/api/mcp`.
      // Worth pinning: it is the likeliest way this breaks in production, and
      // the symptom is every client failing at once.
      const result = await verifyAccessToken(await mint({}, { audience: `${AUDIENCE}/` }), config)
      expect(result.ok).toBe(false)
    })
  })

  test("refuses a token from a different issuer", async () => {
    const result = await verifyAccessToken(
      await mint({}, { issuer: "https://evil.example" }),
      config,
    )
    expect(result.ok).toBe(false)
  })

  test("refuses an expired token, and says so", async () => {
    const result = await verifyAccessToken(await mint({}, { expiresIn: "-1m" }), config)
    expect(result).toEqual({ ok: false, error: "Access token has expired" })
  })

  test("refuses a token signed with the wrong key", async () => {
    const other = await generateKeyPair("RS256", { extractable: true })
    const result = await verifyAccessToken(await mint({}, { key: other.privateKey }), config)
    expect(result).toEqual({ ok: false, error: "Access token signature is invalid" })
  })

  test("refuses a token that names no client", async () => {
    // Without `client_id` a token cannot be matched to the consent that
    // authorised it — and falling back to "any grant this user has" would let
    // one connected app act through another's permissions.
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey)

    expect(await verifyAccessToken(token, config)).toEqual({
      ok: false,
      error: "Token names no client",
    })
  })

  test("refuses garbage without throwing", async () => {
    for (const bad of ["", "not.a.jwt", "a.b.c", "Bearer something"]) {
      const result = await verifyAccessToken(bad, config)
      expect(result.ok).toBe(false)
    }
  })
})
