/**
 * The MCP endpoint authenticated by OAuth rather than by an API key.
 *
 * The point of these tests is that the two credentials converge: past
 * `principalFromBearer`, an OAuth caller and a key caller are the same thing.
 * Same tools, same scope filtering, same tenancy, same audit row. If that ever
 * stops being true, the second credential becomes a second permission system to
 * keep correct — and the one that gets forgotten is the one that leaks.
 *
 * A real RS256 key pair signs the tokens and a stubbed JWKS endpoint serves the
 * public half, so the signature and audience checks genuinely run. The only
 * thing faked is the network hop to the authorization server.
 */

import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose"
import { db } from "@/lib/db"
import {
  forms,
  mcpAuditLog,
  mcpOauthGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import { recordConsent, revokeGrant } from "@/lib/mcp/oauth/grants"
import { resetJwksCache } from "@/lib/mcp/oauth/verify"

const ISSUER = "https://as.example.test"
const SITE = "http://localhost:3000"
const ENDPOINT = `${SITE}/api/mcp`
const PROTOCOL_VERSION = "2026-07-28"

let privateKey: CryptoKey
let publicJwk: JWK
let realFetch: typeof globalThis.fetch

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true })
  privateKey = pair.privateKey
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" }

  realFetch = globalThis.fetch
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

  process.env.MCP_OAUTH_ISSUER = ISSUER
  process.env.MCP_OAUTH_JWKS_URI = `${ISSUER}/oauth2/jwks`
  process.env.NEXT_PUBLIC_SITE_URL = SITE
  resetJwksCache()
})

afterAll(() => {
  globalThis.fetch = realFetch
  delete process.env.MCP_OAUTH_ISSUER
  delete process.env.MCP_OAUTH_JWKS_URI
})

const { POST } = await import("@/app/api/mcp/route")

/** The canonical resource, which is what `aud` must equal exactly. */
const AUDIENCE = `${SITE}/api/mcp`

async function mintToken(
  subject: string,
  { clientId = "client_abc", audience = AUDIENCE, expiresIn = "10m" } = {},
): Promise<string> {
  return new SignJWT({ client_id: clientId })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey)
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
      publicId: `oa${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  return { userId: user.id, workspaceId: workspace.id, formId: form.id }
}

let rpcId = 0

async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
  rpcId += 1
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "Mcp-Method": method,
    host: "localhost:3000",
  }
  if (typeof params.name === "string") headers["Mcp-Name"] = params.name
  if (token) headers.authorization = `Bearer ${token}`

  const response = await POST(
    new Request(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "makingflow-tests", version: "0.0.0" },
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
  return { status: response.status, body, headers: response.headers }
}

const callTool = (token: string, name: string, args: Record<string, unknown> = {}) =>
  rpc(token, "tools/call", { name, arguments: args })

function structured(body: unknown): Record<string, unknown> {
  const result = (body as { result?: { structuredContent?: Record<string, unknown> } }).result
  if (!result?.structuredContent) throw new Error(`no structuredContent: ${JSON.stringify(body)}`)
  return result.structuredContent
}

describe("MCP over OAuth", () => {
  let tenant: Awaited<ReturnType<typeof seedTenant>>
  let token: string

  beforeEach(async () => {
    tenant = await seedTenant("alice")
    await recordConsent({
      userId: tenant.userId,
      clientId: "client_abc",
      clientName: "Claude",
      scopes: ["forms:read", "forms:write"],
      workspaceIds: [tenant.workspaceId],
    })
    token = await mintToken(tenant.userId)
  })

  test("a consented token lists the workspace's forms", async () => {
    const { body } = await callTool(token, "makingflow_list_forms")
    const out = structured(body)
    expect((out.forms as { id: string }[]).map((f) => f.id)).toEqual([tenant.formId])
  })

  test("scopes on the grant filter the tool list, exactly as a key's do", async () => {
    const { body } = await rpc(token, "tools/list")
    const names = (
      (body as { result?: { tools?: { name: string }[] } }).result?.tools ?? []
    ).map((t) => t.name)

    expect(names).toContain("makingflow_list_forms")
    expect(names).toContain("makingflow_rename_form")
    // The grant carries no submissions scope, so those tools are not offered.
    expect(names).not.toContain("makingflow_list_submissions")
    expect(names).not.toContain("makingflow_export_submissions")
  })

  test("a write through an OAuth token really writes", async () => {
    await callTool(token, "makingflow_rename_form", {
      formId: tenant.formId,
      title: "Renamed by an app",
    })
    const [row] = await db
      .select({ title: forms.title })
      .from(forms)
      .where(eq(forms.id, tenant.formId))
    expect(row.title).toBe("Renamed by an app")
  })

  test("the audit row names the grant, not a key", async () => {
    await callTool(token, "makingflow_list_forms")
    const [entry] = await db
      .select({ keyId: mcpAuditLog.keyId, grantId: mcpAuditLog.grantId, tool: mcpAuditLog.tool })
      .from(mcpAuditLog)
      .where(eq(mcpAuditLog.workspaceId, tenant.workspaceId))

    expect(entry.tool).toBe("makingflow_list_forms")
    expect(entry.grantId).not.toBeNull()
    expect(entry.keyId).toBeNull()
  })

  describe("refusals", () => {
    test("a token minted for another resource is refused", async () => {
      // The confused-deputy case: same issuer, same key, valid token — for
      // somebody else's MCP server.
      const wrong = await mintToken(tenant.userId, {
        audience: "https://someone-else.example/api/mcp",
      })
      const { status } = await callTool(wrong, "makingflow_list_forms")
      expect(status).toBe(401)
    })

    test("an expired token is refused", async () => {
      const stale = await mintToken(tenant.userId, { expiresIn: "-1m" })
      expect((await callTool(stale, "makingflow_list_forms")).status).toBe(401)
    })

    test("a token from a client the user never connected reaches nothing", async () => {
      // 403, not 401: the token is genuinely valid — the app just has no
      // workspaces yet. Sending a 401 would tell the client to re-authorise,
      // which would produce another valid token and another 401, forever.
      const other = await mintToken(tenant.userId, { clientId: "client_never_seen" })
      const { status, body } = await callTool(other, "makingflow_list_forms")

      expect(status).toBe(403)
      // The refusal names the page that fixes it, because the user sees this
      // message inside their assistant with nothing else to go on.
      expect(JSON.stringify(body)).toContain("/integrations")

      // It reached no forms, and did not inherit the other client's grant.
      expect(JSON.stringify(body)).not.toContain(tenant.formId)
    })

    test("disconnecting the app stops it on the next call", async () => {
      expect((await callTool(token, "makingflow_list_forms")).status).toBe(200)

      const [grant] = await db
        .select({ id: mcpOauthGrants.id })
        .from(mcpOauthGrants)
        .where(eq(mcpOauthGrants.userId, tenant.userId))
      await revokeGrant(tenant.userId, grant.id)

      // No sweep, no token to chase down — the very next request fails.
      expect((await callTool(token, "makingflow_list_forms")).status).toBe(401)
    })

    test("losing membership cuts the app off, with a 403 rather than a 401", async () => {
      await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, tenant.userId))
      // 403: the token is fine, the access is gone. Re-authorising would not
      // help, and telling the client to try sends it into a loop.
      expect((await callTool(token, "makingflow_list_forms")).status).toBe(403)
    })

    test("cannot reach a workspace outside the grant", async () => {
      // The user belongs to a second workspace but did not consent to it.
      seq += 1
      const [other] = await db
        .insert(workspaces)
        .values({ name: "Unconsented", slug: `ws-unconsented-${seq}-${Date.now()}` })
        .returning({ id: workspaces.id })
      await db
        .insert(workspaceMembers)
        .values({ workspaceId: other.id, userId: tenant.userId, role: "owner" })

      const { body } = await callTool(token, "makingflow_list_forms", { workspaceId: other.id })
      // Refused with the same message as a workspace that does not exist — the
      // API never confirms one the credential cannot see.
      expect(JSON.stringify(body)).toMatch(/not found|workspace/i)
      expect(JSON.stringify(body)).not.toContain("Unconsented")
    })
  })

  test("the discovery document names the authorization server once configured", async () => {
    const { GET } = await import("@/app/.well-known/oauth-protected-resource/route")
    const response = await GET(new Request(`${SITE}/.well-known/oauth-protected-resource`))
    const doc = await response.json()

    expect(doc.authorization_servers).toEqual([ISSUER])
    // The resource must match what a client sends as `resource`, byte for byte.
    expect(doc.resource).toBe(AUDIENCE)
  })
})
