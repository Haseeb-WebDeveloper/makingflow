/**
 * Discovery must describe the server we actually built.
 *
 * A client reads this document once and picks its path from it — then does not
 * retry the other one. So a capability claimed here and missing in the code does
 * not degrade, it dead-ends, and it dead-ends LATE: discovery succeeds,
 * registration succeeds, and the flow dies at /authorize with an error about
 * something that looks unrelated.
 *
 * That is not hypothetical. This file exists because we advertised
 * `client_id_metadata_document_supported` while `findClient` only resolved
 * uuids. A CIMD client_id is a URL, so Claude would have been told "Unknown
 * client" at the one step it could not recover from.
 *
 * The rule these tests encode: every advertised capability is reachable, and
 * every endpoint named here exists.
 */

import { describe, expect, test } from "vitest"

const SITE = "http://localhost:3000"

const { GET: asMetadata } = await import(
  "@/app/.well-known/oauth-authorization-server/route"
)

async function discovery() {
  const response = await asMetadata(
    new Request(`${SITE}/.well-known/oauth-authorization-server`),
  )
  return { response, doc: await response.json() }
}

describe("authorization server metadata", () => {
  test("names endpoints that exist", async () => {
    const { doc } = await discovery()

    expect(doc.issuer).toBe(SITE)
    expect(doc.authorization_endpoint).toBe(`${SITE}/api/oauth/authorize`)
    expect(doc.token_endpoint).toBe(`${SITE}/api/oauth/token`)
    expect(doc.registration_endpoint).toBe(`${SITE}/api/oauth/register`)
    expect(doc.revocation_endpoint).toBe(`${SITE}/api/oauth/revoke`)

    // Each one is a real module. A metadata document pointing at a route that
    // was renamed or never written is the failure this catches.
    await expect(import("@/app/api/oauth/authorize/route")).resolves.toBeTruthy()
    await expect(import("@/app/api/oauth/token/route")).resolves.toBeTruthy()
    await expect(import("@/app/api/oauth/register/route")).resolves.toBeTruthy()
    await expect(import("@/app/api/oauth/revoke/route")).resolves.toBeTruthy()
  })

  test("does not claim CIMD, which we do not implement", async () => {
    const { doc } = await discovery()

    // The bug this file was written for. A CIMD client_id is a URL the server
    // fetches; ours resolves a uuid against our own table. Claiming support
    // sends clients down a path that fails at /authorize, after discovery and
    // registration both appeared to work.
    expect(doc.client_id_metadata_document_supported).toBeUndefined()

    // And the registration endpoint they will use instead is advertised.
    expect(doc.registration_endpoint).toBeTruthy()
  })

  test("advertises S256 and nothing weaker", async () => {
    const { doc } = await discovery()

    // Clients check this before starting and refuse to proceed without it.
    expect(doc.code_challenge_methods_supported).toEqual(["S256"])
    // `plain` would make the challenge the verifier, which is the whole attack
    // PKCE exists to stop.
    expect(doc.code_challenge_methods_supported).not.toContain("plain")
  })

  test("advertises refresh, or clients re-consent every hour", async () => {
    const { doc } = await discovery()
    expect(doc.grant_types_supported).toContain("authorization_code")
    expect(doc.grant_types_supported).toContain("refresh_token")

    // Both removed in OAuth 2.1.
    expect(doc.grant_types_supported).not.toContain("implicit")
    expect(doc.grant_types_supported).not.toContain("password")
    expect(doc.response_types_supported).toEqual(["code"])
  })

  test("says clients are public, since we authenticate none of them", async () => {
    const { doc } = await discovery()
    expect(doc.token_endpoint_auth_methods_supported).toEqual(["none"])
  })

  test("every advertised scope is one the server recognises", async () => {
    const { doc } = await discovery()
    const { isScope } = await import("@/lib/auth/context")

    expect(doc.scopes_supported.length).toBeGreaterThan(0)
    for (const scope of doc.scopes_supported) {
      expect(isScope(scope)).toBe(true)
    }
    // `destructive` is deliberately not offered: it is added by defineTool for
    // the tools that need it, never something a client asks for up front.
    expect(doc.scopes_supported).not.toContain("destructive")
  })

  test("is readable cross-origin, or a browser client never gets this far", async () => {
    const { response } = await discovery()
    expect(response.headers.get("access-control-allow-origin")).toBeTruthy()
  })

  test("the protected resource points back at us as its own authorization server", async () => {
    const { protectedResourceMetadata } = await import("@/lib/mcp/metadata")
    const prm = protectedResourceMetadata(
      new Request(`${SITE}/.well-known/oauth-protected-resource`),
    )
    const { doc } = await discovery()

    // The client reads the PRM, follows `authorization_servers` to the document
    // above, and expects `issuer` to match. A mismatch here is the "works in
    // curl, fails in a real client" class of bug.
    expect(prm.authorization_servers).toEqual([doc.issuer])
    expect(prm.resource).toBe(`${SITE}/api/mcp`)
  })
})
