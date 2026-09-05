/**
 * The whole OAuth flow, from an unknown client to a working tool call.
 *
 * Register → authorize → consent → code → token → call → refresh → disconnect,
 * driven the way a real client drives it, including form-urlencoded bodies at
 * the token endpoint and a genuine PKCE verifier.
 *
 * The attack cases are the reason this file is long. An authorization server is
 * mostly a set of refusals, and each one below prevents a specific, known way of
 * stealing an account:
 *
 *   - a redirect that was never registered  → codes delivered to an attacker
 *   - a code redeemed without the verifier  → a leaked code becomes access
 *   - a code redeemed twice                 → whoever redeemed first keeps access
 *   - a refresh token reused after rotation → a stolen token stays live
 *
 * Every one of those passes silently if the check is missing, which is exactly
 * why they are asserted rather than assumed.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  mcpOauthGrants,
  mcpOauthTokens,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import { recordConsent } from "@/lib/mcp/oauth/grants"

const SITE = "http://localhost:3000"
const PROTOCOL_VERSION = "2026-07-28"
const REDIRECT = "https://client.example/callback"

/**
 * The browser session /authorize resolves the user from.
 *
 * Only the session is mocked. Everything the flow actually turns on — the
 * client registration, PKCE, the code, the tokens, the grant — is real, so
 * these tests fail if any of it is wrong rather than being handed the answer.
 */
const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/auth/session", () => ({
  getOptionalUser: async () => (session.userId ? { id: session.userId } : null),
  getRequiredUser: async () => {
    if (!session.userId) throw new Error("not signed in")
    return { id: session.userId }
  },
}))

const { POST: register } = await import("@/app/api/oauth/register/route")
const { GET: authorize } = await import("@/app/api/oauth/authorize/route")
const { POST: tokenEndpoint } = await import("@/app/api/oauth/token/route")
const { POST: revokeEndpoint } = await import("@/app/api/oauth/revoke/route")
const { POST: mcp } = await import("@/app/api/mcp/route")

/** A PKCE pair, exactly as a client generates one. */
function pkce() {
  const verifier = randomBytes(32).toString("base64url")
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }
}

let seq = 0

async function seedTenant(label: string) {
  seq += 1
  const unique = `${label}-${seq}-${Date.now()}`
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${unique}@example.test`, name: label })
    .returning({ id: users.id })
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `WS ${unique}`, slug: `ws-${unique}` })
    .returning({ id: workspaces.id })
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      title: `${label}'s form`,
      publicId: `fl${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  return { userId: user.id, workspaceId: workspace.id, formId: form.id }
}

/** Register a client the way ChatGPT would. */
async function registerClient(redirectUris = [REDIRECT]) {
  const response = await register(
    new Request(`${SITE}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Test Client", redirect_uris: redirectUris }),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Run /authorize and report where it sent the user. `redirect()` throws. */
async function visitAuthorize(params: Record<string, string>) {
  const url = new URL("/api/oauth/authorize", SITE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  try {
    const response = await authorize(new Request(url))
    return { redirectedTo: null as string | null, response }
  } catch (error) {
    const digest = (error as { digest?: string }).digest
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return { redirectedTo: digest.split(";")[2] ?? "", response: null }
    }
    throw error
  }
}

/** POST the token endpoint the way a real client does: form-urlencoded. */
async function postToken(fields: Record<string, string>) {
  const response = await tokenEndpoint(
    new Request(`${SITE}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  )
  return { status: response.status, body: await response.json() }
}

let rpcId = 0

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  rpcId += 1
  const response = await mcp(
    new Request(`${SITE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
        host: "localhost:3000",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "tests", version: "0.0.0" },
          },
        },
      }),
    }),
  )
  const text = await response.text()
  let body: unknown = text
  if (text.startsWith("event:") || text.startsWith("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"))
    body = line ? JSON.parse(line.slice(5).trim()) : text
  } else if (text.trim().startsWith("{")) {
    body = JSON.parse(text)
  }
  return { status: response.status, body }
}

describe("OAuth end to end", () => {
  let tenant: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    tenant = await seedTenant("alice")
    session.userId = tenant.userId
  })

  /** Consent already given, so /authorize issues a code straight away. */
  async function connectedClient(scopes: string[] = ["forms:read", "forms:write"]) {
    const { body } = await registerClient()
    const clientId = body.client_id as string
    await recordConsent({
      userId: tenant.userId,
      clientId,
      clientName: "Test Client",
      scopes: scopes as never,
      workspaceIds: [tenant.workspaceId],
    })
    return clientId
  }

  test("registration issues an id and no secret", async () => {
    const { status, body } = await registerClient()
    expect(status).toBe(201)
    expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/)
    // Public clients: a shipped secret is a published secret, so there is none.
    expect(body.client_secret).toBeUndefined()
    expect(body.token_endpoint_auth_method).toBe("none")
    expect(body.redirect_uris).toEqual([REDIRECT])
  })

  test("the full dance, then a real tool call", async () => {
    const clientId = await connectedClient()
    const { verifier, challenge } = pkce()

    const { redirectedTo } = await visitAuthorize({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "opaque-state",
    })

    const back = new URL(redirectedTo!)
    expect(back.origin + back.pathname).toBe(REDIRECT)
    // Echoed untouched — it is the client's CSRF protection.
    expect(back.searchParams.get("state")).toBe("opaque-state")
    const code = back.searchParams.get("code")!
    expect(code).toBeTruthy()

    const { status, body } = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })
    expect(status).toBe(200)
    expect(body.token_type).toBe("Bearer")
    expect(body.access_token).toMatch(/^mf_at_/)
    expect(body.refresh_token).toMatch(/^mf_rt_/)

    const call = await callTool(body.access_token, "makingflow_list_forms")
    const structured = (call.body as { result?: { structuredContent?: { forms?: { id: string }[] } } })
      .result?.structuredContent
    expect(structured?.forms?.map((f) => f.id)).toEqual([tenant.formId])
  })

  test("an unconsented client is sent to our consent screen, not given a code", async () => {
    const { body } = await registerClient()
    const { challenge } = pkce()

    const { redirectedTo } = await visitAuthorize({
      response_type: "code",
      client_id: body.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })

    const target = new URL(redirectedTo!, SITE)
    expect(target.pathname).toBe("/oauth/consent")
    expect(target.searchParams.get("client_id")).toBe(body.client_id)
    // Carried through so approving can finish the authorization in one step.
    expect(target.searchParams.get("code_challenge")).toBe(challenge)
  })

  describe("refusals that matter", () => {
    test("a redirect_uri that was never registered is shown, never followed", async () => {
      const clientId = await connectedClient()
      const { challenge } = pkce()

      const { redirectedTo, response } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://evil.test/steal",
        code_challenge: challenge,
        code_challenge_method: "S256",
      })

      // THE open-redirect case. Following this would deliver codes to an
      // attacker, so it must be a page the user sees, not a 302.
      expect(redirectedTo).toBeNull()
      expect(response?.status).toBe(400)
      expect(await response!.text()).not.toContain("evil.test/steal?")
    })

    test("a prefix of a registered redirect does not match", async () => {
      // `https://client.example/callback` also prefixes
      // `https://client.example/callback.evil.test` — which is precisely why
      // matching is exact-string and not startsWith.
      const clientId = await connectedClient()
      const { challenge } = pkce()

      const { response } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: `${REDIRECT}.evil.test`,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      expect(response?.status).toBe(400)
    })

    test("an unknown client is shown an error rather than redirected", async () => {
      const { challenge } = pkce()
      const { response } = await visitAuthorize({
        response_type: "code",
        client_id: randomUUID(),
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      expect(response?.status).toBe(400)
    })

    test("no PKCE means no authorization", async () => {
      const clientId = await connectedClient()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        state: "s",
      })

      // The client registered this destination, so the error goes back to it.
      const back = new URL(redirectedTo!)
      expect(back.searchParams.get("error")).toBe("invalid_request")
      expect(back.searchParams.get("code")).toBeNull()
      expect(back.searchParams.get("state")).toBe("s")
    })

    test("plain PKCE is refused — OAuth 2.1 removed it for good reason", async () => {
      // With `plain` the challenge IS the verifier, so anyone who saw the
      // authorization request can redeem the code. That is the whole attack.
      const clientId = await connectedClient()
      const { verifier } = pkce()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: verifier,
        code_challenge_method: "plain",
      })
      expect(new URL(redirectedTo!).searchParams.get("error")).toBe("invalid_request")
    })

    test("a code is worthless without the verifier", async () => {
      const clientId = await connectedClient()
      const { challenge } = pkce()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      const code = new URL(redirectedTo!).searchParams.get("code")!

      // An attacker who intercepted the redirect holds this much and no more.
      const { status, body } = await postToken({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: randomBytes(32).toString("base64url"),
      })
      expect(status).toBe(400)
      expect(body.error).toBe("invalid_grant")
    })

    test("redeeming a code twice revokes everything it produced", async () => {
      const clientId = await connectedClient()
      const { verifier, challenge } = pkce()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      const code = new URL(redirectedTo!).searchParams.get("code")!

      const first = await postToken({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      })
      expect(first.status).toBe(200)

      const second = await postToken({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      })
      expect(second.status).toBe(400)

      // Harsher than merely refusing the replay, on purpose: a code that
      // reached two parties means we cannot tell which is legitimate, and
      // refusing only the second leaves whoever went first — quite possibly the
      // attacker — holding live tokens.
      const dead = await callTool(first.body.access_token, "makingflow_list_forms")
      expect(dead.status).toBe(401)
    })

    test("a code cannot be redeemed against a different redirect", async () => {
      const clientId = await connectedClient()
      const { body } = await registerClient([REDIRECT, "https://client.example/other"])
      void body
      const { verifier, challenge } = pkce()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      const code = new URL(redirectedTo!).searchParams.get("code")!

      const { status } = await postToken({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: "https://client.example/other",
        code_verifier: verifier,
      })
      expect(status).toBe(400)
    })

    test("a resource indicator naming another server is refused", async () => {
      const clientId = await connectedClient()
      const { challenge } = pkce()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://someone-else.example/api/mcp",
      })
      expect(new URL(redirectedTo!).searchParams.get("error")).toBe("invalid_target")
    })
  })

  describe("refresh", () => {
    async function connectAndGetTokens() {
      const clientId = await connectedClient()
      const { verifier, challenge } = pkce()
      const { redirectedTo } = await visitAuthorize({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      const code = new URL(redirectedTo!).searchParams.get("code")!
      const { body } = await postToken({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      })
      return body as { access_token: string; refresh_token: string }
    }

    test("rotates: a new pair, and the old refresh token is spent", async () => {
      const first = await connectAndGetTokens()
      const rotated = await postToken({
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
      })

      expect(rotated.status).toBe(200)
      expect(rotated.body.refresh_token).not.toBe(first.refresh_token)
      // The new access token works.
      expect((await callTool(rotated.body.access_token, "makingflow_list_forms")).status).toBe(200)
    })

    test("reusing a spent refresh token kills the whole connection", async () => {
      const first = await connectAndGetTokens()
      const rotated = await postToken({
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
      })
      expect(rotated.status).toBe(200)

      // Either it leaked or a client is retrying badly. We cannot tell, and
      // only one of those is survivable.
      const replay = await postToken({
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
      })
      expect(replay.status).toBe(400)

      expect((await callTool(rotated.body.access_token, "makingflow_list_forms")).status).toBe(401)
    })
  })

  test("the token endpoint rejects JSON, because the spec says form-urlencoded", async () => {
    // A server that reads JSON here returns 415 to every real client, after the
    // rest of the flow appeared to work perfectly.
    const response = await tokenEndpoint(
      new Request(`${SITE}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code" }),
      }),
    )
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toBe("unsupported_grant_type")
  })

  test("revocation kills the connection and always answers 200", async () => {
    const clientId = await connectedClient()
    const { verifier, challenge } = pkce()
    const { redirectedTo } = await visitAuthorize({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })
    const code = new URL(redirectedTo!).searchParams.get("code")!
    const { body } = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })

    const revoked = await revokeEndpoint(
      new Request(`${SITE}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: body.refresh_token }).toString(),
      }),
    )
    expect(revoked.status).toBe(200)

    // Revoking the refresh token takes the access token with it — a client
    // calling this is signing the user out, not tidying up one credential.
    expect((await callTool(body.access_token, "makingflow_list_forms")).status).toBe(401)

    // A token that never existed also answers 200, so this cannot be used to
    // test guesses.
    const unknown = await revokeEndpoint(
      new Request(`${SITE}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: "mf_rt_nonsense" }).toString(),
      }),
    )
    expect(unknown.status).toBe(200)
  })

  test("disconnecting from settings stops the app on its next call", async () => {
    const clientId = await connectedClient()
    const { verifier, challenge } = pkce()
    const { redirectedTo } = await visitAuthorize({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })
    const code = new URL(redirectedTo!).searchParams.get("code")!
    const { body } = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })
    expect((await callTool(body.access_token, "makingflow_list_forms")).status).toBe(200)

    const { revokeGrant } = await import("@/lib/mcp/oauth/grants")
    const [grant] = await db
      .select({ id: mcpOauthGrants.id })
      .from(mcpOauthGrants)
      .where(eq(mcpOauthGrants.userId, tenant.userId))
    await revokeGrant(tenant.userId, grant.id)

    // No sweep, no waiting for expiry — this is what makes Disconnect honest.
    expect((await callTool(body.access_token, "makingflow_list_forms")).status).toBe(401)
  })

  test("scopes on the grant filter the tool list, exactly as a key's do", async () => {
    const clientId = await connectedClient(["forms:read"])
    const { verifier, challenge } = pkce()
    const { redirectedTo } = await visitAuthorize({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })
    const code = new URL(redirectedTo!).searchParams.get("code")!
    const { body } = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })

    // Read granted, write not.
    expect((await callTool(body.access_token, "makingflow_list_forms")).status).toBe(200)
    const denied = await callTool(body.access_token, "makingflow_rename_form", {
      formId: tenant.formId,
      title: "Nope",
    })
    expect(JSON.stringify(denied.body).toLowerCase()).toMatch(/scope|not found|unknown|invalid/)

    const [row] = await db.select({ title: forms.title }).from(forms).where(eq(forms.id, tenant.formId))
    expect(row.title).not.toBe("Nope")
  })

  test("tokens are stored hashed, never in the clear", async () => {
    const clientId = await connectedClient()
    const { verifier, challenge } = pkce()
    const { redirectedTo } = await visitAuthorize({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })
    const code = new URL(redirectedTo!).searchParams.get("code")!
    const { body } = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })

    const rows = await db.select().from(mcpOauthTokens)
    const dump = JSON.stringify(rows)
    // A database dump must yield nothing redeemable.
    expect(dump).not.toContain(body.access_token)
    expect(dump).not.toContain(body.refresh_token)
  })
})
