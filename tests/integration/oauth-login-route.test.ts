/**
 * The Login URI, where our authentication meets the authorization server's.
 *
 * This is the piece that is easy to build backwards, so it is worth testing at
 * the level of "what actually goes over the wire". The AS redirects the user
 * here with an `external_auth_id`; we must POST that handle BACK to the AS with
 * the identity we resolved, authenticated with our API key, and then send the
 * user to the `redirect_uri` the AS returns. It is not a redirect with the id
 * appended — that produces a flow that looks right and dead-ends at the AS.
 *
 * So the completion endpoint is stubbed and the REQUEST is asserted: method,
 * authorization header, and the identity in the body. A test that only checked
 * "did we redirect somewhere" would pass with the wrong design.
 */

import { randomUUID } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpOauthGrants, users, workspaceMembers, workspaces } from "@/lib/db/schema"
import { recordConsent } from "@/lib/mcp/oauth/grants"

const ISSUER = "https://as.example.test"
const SITE = "http://localhost:3000"
const COMPLETE_URL = "https://api.workos.test/authkit/oauth2/complete"

/** The signed-in user, or null. Swapped per test. */
const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/auth/session", () => ({
  getOptionalUser: async () => (session.userId ? { id: session.userId } : null),
}))

let realFetch: typeof globalThis.fetch
let completionCalls: { method: string; authorization: string | null; body: unknown }[] = []
let completionStatus = 200

beforeAll(() => {
  process.env.MCP_OAUTH_ISSUER = ISSUER
  process.env.NEXT_PUBLIC_SITE_URL = SITE
  process.env.WORKOS_API_KEY = "sk_test_workos"
  process.env.WORKOS_COMPLETION_URL = COMPLETE_URL

  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url === COMPLETE_URL) {
      completionCalls.push({
        method: init?.method ?? "GET",
        authorization:
          new Headers(init?.headers).get("authorization") ?? null,
        body: JSON.parse(String(init?.body ?? "null")),
      })
      return completionStatus === 200
        ? new Response(
            JSON.stringify({ redirect_uri: `${ISSUER}/oauth2/continue?handle=abc` }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        : new Response("nope", { status: completionStatus })
    }
    return realFetch(input as RequestInfo, init)
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  delete process.env.MCP_OAUTH_ISSUER
  delete process.env.WORKOS_API_KEY
  delete process.env.WORKOS_COMPLETION_URL
})

afterEach(() => {
  completionCalls = []
  completionStatus = 200
})

const { GET } = await import("@/app/api/mcp/oauth/login/route")

/**
 * Call the route and report where it sends the user.
 *
 * `redirect()` works by throwing, and Next tags the error with the location —
 * so a redirect is caught here rather than read off a Response.
 */
async function visit(query: Record<string, string>) {
  const url = new URL("/api/mcp/oauth/login", SITE)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)

  try {
    const response = await GET(new Request(url))
    return { redirectedTo: null as string | null, response }
  } catch (error) {
    const digest = (error as { digest?: string }).digest
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      // digest form: NEXT_REDIRECT;<kind>;<url>;<status>;
      return { redirectedTo: digest.split(";")[2] ?? "", response: null }
    }
    throw error
  }
}

let seq = 0

async function seedUser() {
  seq += 1
  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: `login-${seq}-${Date.now()}@example.test`,
      name: "Ada Lovelace",
    })
    .returning({ id: users.id })
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Alpha", slug: `ws-login-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "owner" })
  return { userId: user.id, workspaceId: ws.id }
}

describe("the Login URI", () => {
  let user: Awaited<ReturnType<typeof seedUser>>

  beforeEach(async () => {
    user = await seedUser()
    session.userId = null
  })

  test("without external_auth_id there is nothing to complete", async () => {
    session.userId = user.userId
    const { response } = await visit({})
    expect(response?.status).toBe(400)
    expect(completionCalls).toHaveLength(0)
  })

  test("a signed-out visitor goes to our login and comes back here", async () => {
    const { redirectedTo } = await visit({ external_auth_id: "eai_123" })

    const target = new URL(redirectedTo!, SITE)
    expect(target.pathname).toBe("/auth/login")
    // Same-origin relative path only — the round trip cannot be aimed off our
    // domain even though a third party chose where this flow started.
    const back = target.searchParams.get("redirectTo")!
    expect(back.startsWith("/api/mcp/oauth/login")).toBe(true)
    expect(back).toContain("eai_123")

    // Nothing was handed to the AS before we knew who was here.
    expect(completionCalls).toHaveLength(0)
  })

  test("hands the identity back over a server-to-server POST, then follows the AS", async () => {
    session.userId = user.userId
    const { redirectedTo } = await visit({ external_auth_id: "eai_123" })

    expect(completionCalls).toHaveLength(1)
    const call = completionCalls[0]
    expect(call.method).toBe("POST")
    // Authenticated with our secret, so the identity never crosses in a URL the
    // browser can see and edit.
    expect(call.authorization).toBe("Bearer sk_test_workos")
    expect(call.body).toMatchObject({
      external_auth_id: "eai_123",
      user: { id: user.userId, first_name: "Ada Lovelace" },
    })

    // The destination comes from the AS's response. Inventing one is the
    // failure this test exists to catch.
    expect(redirectedTo).toBe(`${ISSUER}/oauth2/continue?handle=abc`)
  })

  describe("when the client is known", () => {
    test("asks which workspaces before connecting anything", async () => {
      session.userId = user.userId
      const { redirectedTo } = await visit({
        external_auth_id: "eai_123",
        client_id: "client_abc",
        client_name: "Claude",
      })

      const target = new URL(redirectedTo!, SITE)
      expect(target.pathname).toBe("/oauth/consent")
      expect(target.searchParams.get("client_id")).toBe("client_abc")
      // Carried through, so approving can resume the paused authorization.
      expect(target.searchParams.get("external_auth_id")).toBe("eai_123")

      // The AS has NOT been told anything yet — the flow is genuinely paused.
      expect(completionCalls).toHaveLength(0)
    })

    test("does not ask again once consent exists", async () => {
      session.userId = user.userId
      await recordConsent({
        userId: user.userId,
        clientId: "client_abc",
        clientName: "Claude",
        scopes: ["forms:read"],
        workspaceIds: [user.workspaceId],
      })

      const { redirectedTo } = await visit({
        external_auth_id: "eai_123",
        client_id: "client_abc",
      })
      expect(redirectedTo).toBe(`${ISSUER}/oauth2/continue?handle=abc`)
      expect(completionCalls).toHaveLength(1)
    })

    test("resumes the flow when returning from consent", async () => {
      session.userId = user.userId
      // No grant yet, but `consented=1` says the user just answered — so this
      // must complete rather than bouncing back to the consent screen and
      // looping forever.
      const { redirectedTo } = await visit({
        external_auth_id: "eai_123",
        client_id: "client_abc",
        consented: "1",
      })
      expect(redirectedTo).toBe(`${ISSUER}/oauth2/continue?handle=abc`)
    })
  })

  describe("failures the user can act on", () => {
    test("an expired handle says so rather than 500ing", async () => {
      session.userId = user.userId
      completionStatus = 400

      const { response } = await visit({ external_auth_id: "eai_stale" })
      expect(response?.status).toBe(502)
      expect(await response!.text()).toMatch(/expired/i)
    })

    test("an authorization service outage is reported, not swallowed", async () => {
      session.userId = user.userId
      completionStatus = 503

      const { response } = await visit({ external_auth_id: "eai_123" })
      expect(response?.status).toBe(502)
      expect(await response!.text()).toMatch(/authorization service/i)
    })

    test("with OAuth switched off the route does not exist", async () => {
      const issuer = process.env.MCP_OAUTH_ISSUER
      delete process.env.MCP_OAUTH_ISSUER
      try {
        session.userId = user.userId
        const { response } = await visit({ external_auth_id: "eai_123" })
        expect(response?.status).toBe(404)
      } finally {
        process.env.MCP_OAUTH_ISSUER = issuer
      }
    })
  })

  test("connecting never writes a grant on its own", async () => {
    // The Login URI proves identity. It does not decide access — that is the
    // consent screen's job, and conflating them is how an app ends up reaching
    // workspaces nobody ticked.
    session.userId = user.userId
    await visit({ external_auth_id: "eai_123" })

    expect(
      await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.userId, user.userId)),
    ).toHaveLength(0)
  })
})
