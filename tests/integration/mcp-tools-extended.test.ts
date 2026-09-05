/**
 * The nine tools that complete parity with the web app, through the real route.
 *
 * Same approach as mcp-route.test.ts: a real key row, a real Authorization
 * header, no mocked session. What is under test here is mostly what these tools
 * DO NOT return.
 *
 * Three secrets and one bearer credential pass through this surface — a webhook
 * signing secret, a Discord webhook URL, an OAuth token, and a workspace invite
 * link — and each of them would be a real incident if it reached a model's
 * context. `defineTool` requires a closed Zod output schema, so a field that
 * leaks one fails validation rather than shipping; these tests assert the
 * absence directly, against the serialised response, so that a future edit
 * which widens a schema is caught by a failing test and not by a review.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  customDomains,
  formIntegrations,
  forms,
  mcpApiKeys,
  mcpKeyWorkspaces,
  users,
  workspaceConnections,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import { hashApiKey } from "@/lib/integrations/crypto"
import { verifyExportToken } from "@/lib/mcp/export-token"
import { testContext } from "../helpers/context"

const { POST } = await import("@/app/api/mcp/route")

const ENDPOINT = "http://localhost:3000/api/mcp"
const PROTOCOL_VERSION = "2026-07-28"

const ALL_SCOPES = [
  "forms:read",
  "forms:write",
  "submissions:read",
  "submissions:write",
  "analytics:read",
  "integrations:write",
  "team:write",
]

let seq = 0

async function seedTenantWithKey(
  label: string,
  { scopes = ALL_SCOPES, role = "owner" as "owner" | "member" } = {},
) {
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
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role })

  const token = `mf_sk_live_${unique}-secret`
  const [key] = await db
    .insert(mcpApiKeys)
    .values({
      userId: user.id,
      name: `${label} key`,
      prefix: token.slice(0, 15),
      keyHash: hashApiKey(token),
      scopes,
    })
    .returning({ id: mcpApiKeys.id })
  await db.insert(mcpKeyWorkspaces).values({ keyId: key.id, workspaceId: workspace.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      title: `${label}'s form`,
      publicId: `ext${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  return {
    token,
    userId: user.id,
    workspaceId: workspace.id,
    formId: form.id,
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
  }
}

let rpcId = 0

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  rpcId += 1
  const response = await POST(
    new Request(ENDPOINT, {
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
  return { status: response.status, body, raw: text }
}

function structured(body: unknown): Record<string, unknown> {
  const result = (body as { result?: { structuredContent?: Record<string, unknown> } }).result
  if (!result?.structuredContent) throw new Error(`no structuredContent: ${JSON.stringify(body)}`)
  return result.structuredContent
}

function toolError(body: unknown): string {
  const result = (body as {
    result?: { isError?: boolean; content?: { type: string; text: string }[] }
  }).result
  if (!result?.isError) throw new Error(`expected isError: ${JSON.stringify(body)}`)
  return result.content?.map((c) => c.text).join("\n") ?? ""
}

describe("integration tools", () => {
  let alice: Awaited<ReturnType<typeof seedTenantWithKey>>

  beforeEach(async () => {
    alice = await seedTenantWithKey("alice")
  })

  test("a webhook's signing secret never comes back out", async () => {
    const secret = "SIGNING-SECRET-MUST-NOT-APPEAR"
    const added = await callTool(alice.token, "makingflow_manage_webhook", {
      operation: "add",
      formId: alice.formId,
      url: "https://example.com/hook",
      secret,
    })
    expect(structured(added.body).webhooks).toHaveLength(1)
    // Not merely absent from the parsed object — absent from the bytes.
    expect(added.raw).not.toContain(secret)

    const listed = await callTool(alice.token, "makingflow_list_integrations", {
      formId: alice.formId,
    })
    const webhooks = structured(listed.body).webhooks as { hasSecret: boolean }[]
    expect(webhooks[0].hasSecret).toBe(true)
    expect(listed.raw).not.toContain(secret)
  })

  test("a Discord webhook URL is only ever shown masked", async () => {
    const url = "https://discord.com/api/webhooks/123456789/SECRETTOKENABCDEFGHIJ"
    const saved = await callTool(alice.token, "makingflow_configure_integration", {
      formId: alice.formId,
      target: "discord",
      enabled: true,
      includeAnswers: true,
      webhookUrl: url,
    })
    expect(structured(saved.body).enabled).toBe(true)

    const listed = await callTool(alice.token, "makingflow_list_integrations", {
      formId: alice.formId,
    })
    const notifications = structured(listed.body).notifications as {
      discord: { configured: boolean; maskedUrl: string | null }
    }[]
    expect(notifications[0].discord.configured).toBe(true)
    // The URL IS the credential: recognisable, not usable.
    expect(listed.raw).not.toContain("SECRETTOKENABCDEFGHIJ")
    expect(notifications[0].discord.maskedUrl).toContain("123456789")
  })

  test("OAuth tokens never appear in a connections listing", async () => {
    await db.insert(workspaceConnections).values({
      workspaceId: alice.workspaceId,
      provider: "google",
      accountEmail: "owner@example.com",
      accessToken: "ACCESS-TOKEN-MUST-NOT-APPEAR",
      refreshToken: "REFRESH-TOKEN-MUST-NOT-APPEAR",
    })

    const listed = await callTool(alice.token, "makingflow_list_integrations", {})
    const connections = structured(listed.body).connections as {
      provider: string
      connected: boolean
      accountEmail: string | null
    }[]
    expect(connections.find((c) => c.provider === "google")).toEqual({
      provider: "google",
      connected: true,
      accountEmail: "owner@example.com",
    })
    expect(listed.raw).not.toContain("ACCESS-TOKEN-MUST-NOT-APPEAR")
    expect(listed.raw).not.toContain("REFRESH-TOKEN-MUST-NOT-APPEAR")
  })

  test("a webhook pointed at internal infrastructure is refused", async () => {
    // Under a cookie session this is a human pasting their own endpoint. Under
    // a key a model drives, it is an SSRF probe: send_test_webhook reports the
    // status the endpoint returned.
    for (const url of [
      "http://localhost:5432/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/internal",
    ]) {
      const result = await callTool(alice.token, "makingflow_manage_webhook", {
        operation: "add",
        formId: alice.formId,
        url,
      })
      expect(toolError(result.body)).toBeTruthy()
    }

    const listed = await callTool(alice.token, "makingflow_list_integrations", {
      formId: alice.formId,
    })
    // Nothing stored, so `test` cannot be used to probe them later either.
    expect(structured(listed.body).webhooks).toEqual([])
  })

  test("connecting a provider hands back a link rather than pretending to finish", async () => {
    const result = await callTool(alice.token, "makingflow_connect_provider", {
      provider: "google",
      operation: "connect",
    })
    const out = structured(result.body)
    // OAuth needs a browser and a person. Saying so is the honest answer.
    expect(out.connected).toBe(false)
    expect(out.authorizationUrl).toContain("/api/integrations/google/connect")
  })

  test("a key without integrations:write cannot configure anything", async () => {
    const readOnly = await seedTenantWithKey("readonly", { scopes: ["forms:read"] })
    const result = await callTool(readOnly.token, "makingflow_manage_webhook", {
      operation: "add",
      formId: readOnly.formId,
      url: "https://example.com/hook",
    })

    // The tool is not registered for this key at all, so it is refused as
    // unknown rather than as forbidden. Hiding is not the enforcement — the
    // scope gate in defineTool would refuse it too — but a client that
    // hardcodes the name gets no further either way.
    expect(JSON.stringify(result.body).toLowerCase()).toMatch(/scope|not found|unknown|invalid/)
    expect(
      await db.select().from(formIntegrations).where(eq(formIntegrations.formId, readOnly.formId)),
    ).toHaveLength(0)
  })

  test("cannot add a webhook to another tenant's form", async () => {
    const bob = await seedTenantWithKey("bob")
    const result = await callTool(alice.token, "makingflow_manage_webhook", {
      operation: "add",
      formId: bob.formId,
      url: "https://example.com/hook",
    })
    expect(toolError(result.body)).toBe("Form not found")
    expect(
      await db.select().from(formIntegrations).where(eq(formIntegrations.formId, bob.formId)),
    ).toHaveLength(0)
  })
})

describe("team tools", () => {
  test("the invite link is never returned, only whether it was emailed", async () => {
    const alice = await seedTenantWithKey("alice")
    const result = await callTool(alice.token, "makingflow_manage_team", {
      operation: "invite",
      email: "newcomer@example.test",
      role: "member",
    })
    const out = structured(result.body)
    expect(out).toHaveProperty("emailed")
    // /invite/<token> grants membership to whoever opens it. A model that
    // quoted it into a summary would be handing out the workspace.
    expect(result.raw).not.toContain("/invite/")
    expect(JSON.stringify(out)).not.toMatch(/[0-9a-f]{32}/)
  })

  test("a member's key cannot manage the team, whatever scopes it holds", async () => {
    // Every scope in the system, held by someone whose membership is `member`.
    // The scope gate passes; the role gate does not.
    const member = await seedTenantWithKey("member", { role: "member" })

    for (const args of [
      { operation: "invite", email: "x@example.test" },
      { operation: "remove", userId: randomUUID() },
      { operation: "change_role", userId: randomUUID(), role: "owner" },
    ]) {
      const result = await callTool(member.token, "makingflow_manage_team", args)
      expect(toolError(result.body)).toMatch(/owner/i)
    }

    const listed = await callTool(member.token, "makingflow_list_team", {})
    expect(toolError(listed.body)).toMatch(/owner/i)
  })

  test("an owner sees members and pending invitations, without any join tokens", async () => {
    const alice = await seedTenantWithKey("alice")
    await callTool(alice.token, "makingflow_manage_team", {
      operation: "invite",
      email: "pending@example.test",
    })

    const result = await callTool(alice.token, "makingflow_list_team", {})
    const out = structured(result.body)
    expect((out.members as unknown[])).toHaveLength(1)
    expect((out.invitations as { email: string }[])[0].email).toBe("pending@example.test")
    expect(out.ownerCount).toBe(1)
    expect(result.raw).not.toContain("/invite/")
  })

  test("the last owner cannot demote themselves", async () => {
    const alice = await seedTenantWithKey("alice")
    const result = await callTool(alice.token, "makingflow_manage_team", {
      operation: "change_role",
      userId: alice.userId,
      role: "member",
    })
    expect(toolError(result.body)).toBe("A workspace must keep at least one owner.")
  })
})

describe("domain tools", () => {
  test("listing reports what the deployment can actually do", async () => {
    const alice = await seedTenantWithKey("alice")
    const result = await callTool(alice.token, "makingflow_manage_domain", { operation: "list" })
    const out = structured(result.body)
    // No Vercel credentials in tests, which is also how a self-hosted install
    // looks. The tool says so rather than failing opaquely.
    expect(out.configured).toBe(false)
    expect(out.domains).toEqual([])
  })

  test("cannot attach a form to a domain in another workspace", async () => {
    const alice = await seedTenantWithKey("alice")
    const bob = await seedTenantWithKey("bob")
    const [bobsDomain] = await db
      .insert(customDomains)
      .values({
        workspaceId: bob.workspaceId,
        domain: `forms.bob-${seq}-${Date.now()}.test`,
        status: "active",
      })
      .returning({ id: customDomains.id })

    const result = await callTool(alice.token, "makingflow_manage_domain", {
      operation: "attach",
      formId: alice.formId,
      customDomainId: bobsDomain.id,
      path: "hijack",
    })
    expect(toolError(result.body)).toBe("That domain isn't available.")
  })
})

describe("export tool", () => {
  test("returns a signed link rather than the CSV itself", async () => {
    const alice = await seedTenantWithKey("alice")
    const result = await callTool(alice.token, "makingflow_export_submissions", {
      formId: alice.formId,
    })
    const out = structured(result.body)

    expect(out.downloadUrl).toContain(`/api/forms/${alice.formId}/export?token=`)
    expect(out.responseCount).toBe(0)
    expect(typeof out.expiresInSeconds).toBe("number")

    // The handle carries the workspace it was minted for, so it cannot be
    // replayed against another tenant even though the signature is valid.
    const token = new URL(out.downloadUrl as string).searchParams.get("token")!
    const grant = verifyExportToken(token)
    expect(grant).toMatchObject({
      formId: alice.formId,
      workspaceId: alice.workspaceId,
      userId: alice.userId,
    })
  })

  test("will not mint a handle for another tenant's form", async () => {
    const alice = await seedTenantWithKey("alice")
    const bob = await seedTenantWithKey("bob")
    const result = await callTool(alice.token, "makingflow_export_submissions", {
      formId: bob.formId,
    })
    // Refused before signing: a token for an id we never verified would be a
    // working handle for someone else's responses.
    expect(toolError(result.body)).toBe("Form not found")
  })

  test("a forms-only key cannot export responses", async () => {
    // The scope split is the whole point: a key for building forms can publish
    // all day and never obtain a link to the responses.
    const formsOnly = await seedTenantWithKey("formsonly", {
      scopes: ["forms:read", "forms:write"],
    })
    const result = await callTool(formsOnly.token, "makingflow_export_submissions", {
      formId: formsOnly.formId,
    })
    expect(JSON.stringify(result.body).toLowerCase()).toMatch(/scope|not found|unknown|invalid/)
    // No handle was minted, so there is nothing to replay later.
    expect(result.raw).not.toContain("/export?token=")
  })
})

describe("the tool surface as a whole", () => {
  test("every tool declares a scope, and destructive ones require confirmation", async () => {
    const { TOOLS } = await import("@/lib/mcp/registry")
    expect(TOOLS.length).toBe(27)

    for (const tool of TOOLS) {
      expect(tool.scopes.length).toBeGreaterThan(0)
      expect(tool.name.startsWith("makingflow_")).toBe(true)
      // A destructive tool carries the `destructive` scope on top of its own,
      // so a key minted without it cannot delete regardless of what else it has.
      if (tool.destructive) expect(tool.scopes).toContain("destructive")
      // A read-only tool must not be able to write.
      if (tool.readOnly) {
        expect(tool.scopes).not.toContain("destructive")
      }
    }

    // Names are unique — an aggregating client cannot disambiguate duplicates.
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length)
  })
})
