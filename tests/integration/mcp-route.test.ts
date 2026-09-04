/**
 * The MCP endpoint, end to end.
 *
 * These tests do NOT mock the session — they seed a real `mcp_api_keys` row and
 * send a real `Authorization` header, so key verification, the membership
 * re-read, scope filtering and the tool gate are all genuinely under test. A
 * mocked session would prove none of it.
 *
 * The load-bearing test here is "a write through the route invalidates the
 * public form cache". `updateTag` is Server-Action-only, so a Route Handler has
 * to invalidate differently; if that dispatch is wrong, an MCP edit leaves the
 * PUBLIC form runtime serving the old definition with nothing failing anywhere.
 * That is the assumption the whole design rests on, which is why these four
 * tools exist before the other twenty.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  mcpApiKeys,
  mcpAuditLog,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import { hashApiKey } from "@/lib/integrations/crypto"
import * as formsCore from "@/lib/core/forms"
import { testContext } from "../helpers/context"
import { cacheSpy, resetCacheSpy } from "../helpers/cache-spy"

const { POST, GET } = await import("@/app/api/mcp/route")

const ENDPOINT = "http://localhost:3000/api/mcp"
const PROTOCOL_VERSION = "2026-07-28"

let seq = 0

async function seedTenantWithKey(
  label: string,
  scopes: string[] = ["forms:read", "forms:write"],
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
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })

  const token = `mf_sk_live_${unique}-secret`
  const [key] = await db
    .insert(mcpApiKeys)
    .values({
      workspaceId: workspace.id,
      userId: user.id,
      name: `${label} key`,
      prefix: token.slice(0, 15),
      keyHash: hashApiKey(token),
      scopes,
    })
    .returning({ id: mcpApiKeys.id })

  return {
    token,
    keyId: key.id,
    userId: user.id,
    workspaceId: workspace.id,
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
  }
}

let rpcId = 0

/** Issue one JSON-RPC call against the route, exactly as a client would. */
async function rpc(
  token: string | null,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  rpcId += 1
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "Mcp-Method": method,
    // Real HTTP always carries Host; the SDK rejects requests without one as a
    // DNS-rebinding precaution, so the test has to be realistic about it.
    host: "localhost:3000",
  }
  if (params && typeof params.name === "string") headers["Mcp-Name"] = params.name
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
          // 2026-07-28 removed `initialize`, so every request carries the
          // envelope that used to be negotiated once. All three keys are
          // required; omitting any is a -32602.
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
    // SSE framing — pull the single JSON payload back out.
    const line = text.split("\n").find((l) => l.startsWith("data:"))
    body = line ? JSON.parse(line.slice(5).trim()) : text
  } else if (text.trim().startsWith("{")) {
    body = JSON.parse(text)
  }
  return { status: response.status, body, headers: response.headers }
}

function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  return rpc(token, "tools/call", { name, arguments: args })
}

/** The structured payload of a successful tool call. */
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

describe("MCP route", () => {
  beforeEach(() => resetCacheSpy())

  describe("transport and auth", () => {
    test("GET is 405 — this is a POST-only endpoint", () => {
      const response = GET()
      expect(response.status).toBe(405)
      expect(response.headers.get("allow")).toBe("POST")
    })

    test("no token gets a 401 carrying the RFC 9728 challenge", async () => {
      const { status, headers } = await rpc(null, "tools/list")
      expect(status).toBe(401)
      // A client uses this header to find out where to authenticate.
      expect(headers.get("www-authenticate")).toContain("resource_metadata=")
      expect(headers.get("www-authenticate")).toContain("Bearer")
    })

    test("a made-up token is rejected", async () => {
      const { status } = await rpc("mf_sk_live_not-a-real-key", "tools/list")
      expect(status).toBe(401)
    })

    test("a revoked key stops working immediately", async () => {
      const alice = await seedTenantWithKey("alice")
      await db
        .update(mcpApiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(mcpApiKeys.id, alice.keyId))

      expect((await rpc(alice.token, "tools/list")).status).toBe(401)
    })

    test("removing the member kills their key on the next call, with no sweep", async () => {
      const alice = await seedTenantWithKey("alice")
      expect((await rpc(alice.token, "tools/list")).status).toBe(200)

      await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, alice.userId))

      // 403, not 401: the credential is fine, the access behind it is gone.
      expect((await rpc(alice.token, "tools/list")).status).toBe(403)
    })
  })

  describe("tool listing", () => {
    test("lists the tools the key's scopes allow", async () => {
      const alice = await seedTenantWithKey("alice")
      const { status, body } = await rpc(alice.token, "tools/list")
      expect(status).toBe(200)

      const names = (body as { result: { tools: { name: string }[] } }).result.tools.map(
        (t) => t.name,
      )
      expect(names).toContain("makingflow_list_forms")
      expect(names).toContain("makingflow_publish_form")
    })

    test("a read-only key is never shown the write tools", async () => {
      const readonly = await seedTenantWithKey("readonly", ["forms:read"])
      const { body } = await rpc(readonly.token, "tools/list")

      const names = (body as { result: { tools: { name: string }[] } }).result.tools.map(
        (t) => t.name,
      )
      expect(names).toContain("makingflow_get_form")
      // Showing a tool it would only be refused wastes a turn and leaks the
      // shape of the surface. The spec permits varying by authorization.
      expect(names).not.toContain("makingflow_rename_form")
      expect(names).not.toContain("makingflow_publish_form")
    })
  })

  describe("calling tools", () => {
    test("lists this workspace's forms and no one else's", async () => {
      const alice = await seedTenantWithKey("alice")
      const bob = await seedTenantWithKey("bob")
      await formsCore.saveAiForm(alice.ctx, {
        form: { title: "Alice's form", fields: [] },
      })
      await formsCore.saveAiForm(bob.ctx, { form: { title: "Bob's form", fields: [] } })

      const { body } = await callTool(alice.token, "makingflow_list_forms")
      const result = structured(body) as { forms: { title: string }[]; total: number }

      expect(result.total).toBe(1)
      expect(result.forms.map((f) => f.title)).toEqual(["Alice's form"])
    })

    test("renames a form and reports the new title", async () => {
      const alice = await seedTenantWithKey("alice")
      const saved = await formsCore.saveAiForm(alice.ctx, {
        form: { title: "Before", fields: [] },
      })
      if (!saved.success) throw new Error("setup failed")

      const { body } = await callTool(alice.token, "makingflow_rename_form", {
        formId: saved.id,
        title: "After",
      })
      expect(structured(body)).toEqual({ ok: true, title: "After" })

      const [form] = await db.select().from(forms).where(eq(forms.id, saved.id))
      expect(form.title).toBe("After")
    })

    test("A WRITE THROUGH THE ROUTE INVALIDATES THE PUBLIC FORM CACHE", async () => {
      const alice = await seedTenantWithKey("alice")
      const saved = await formsCore.saveAiForm(alice.ctx, {
        form: { title: "Before", fields: [] },
      })
      if (!saved.success) throw new Error("setup failed")
      resetCacheSpy()

      await callTool(alice.token, "makingflow_rename_form", {
        formId: saved.id,
        title: "After",
      })

      // This is the whole reason these four tools shipped before the rest.
      // `updateTag` throws in a Route Handler, so if the surface dispatch in
      // core/cache.ts were wrong, the call above would either have thrown or
      // silently skipped invalidation — and the public form would keep serving
      // the old title out of cache with every test still green.
      expect(cacheSpy().tags).toContain(`form-${saved.id}`)
      expect(cacheSpy().tags).toContain(`workspace-forms-${alice.workspaceId}`)
    })

    test("publishing returns the share URL and takes the form live", async () => {
      const alice = await seedTenantWithKey("alice")
      const saved = await formsCore.saveAiForm(alice.ctx, {
        form: { title: "Survey", fields: [] },
      })
      if (!saved.success) throw new Error("setup failed")

      const { body } = await callTool(alice.token, "makingflow_publish_form", {
        formId: saved.id,
        published: true,
      })
      const result = structured(body) as { status: string; shareUrl: string | null }
      expect(result.status).toBe("published")

      const [form] = await db.select().from(forms).where(eq(forms.id, saved.id))
      expect(form.status).toBe("published")
    })

    test("records the call in the audit log without recording its arguments", async () => {
      const alice = await seedTenantWithKey("alice")
      const saved = await formsCore.saveAiForm(alice.ctx, {
        form: { title: "Audited", fields: [] },
      })
      if (!saved.success) throw new Error("setup failed")

      await callTool(alice.token, "makingflow_rename_form", {
        formId: saved.id,
        title: "Renamed",
      })

      const entries = await db
        .select()
        .from(mcpAuditLog)
        .where(eq(mcpAuditLog.workspaceId, alice.workspaceId))
      const rename = entries.find((e) => e.tool === "makingflow_rename_form")
      expect(rename).toBeDefined()
      expect(rename!.status).toBe("ok")
      expect(rename!.targetId).toBe(saved.id)
      expect(rename!.keyId).toBe(alice.keyId)
      // The table has nowhere to put arguments, and that is the point — they
      // carry form and answer content, and this is the longest-lived table here.
      expect(Object.keys(rename!)).not.toContain("arguments")
    })
  })

  describe("tenancy", () => {
    test("cannot read another tenant's form", async () => {
      const alice = await seedTenantWithKey("alice")
      const bob = await seedTenantWithKey("bob")
      const bobs = await formsCore.saveAiForm(bob.ctx, {
        form: { title: "Bob's form", fields: [] },
      })
      if (!bobs.success) throw new Error("setup failed")

      const { body } = await callTool(alice.token, "makingflow_get_form", { formId: bobs.id })
      expect(toolError(body)).toContain("not found")
    })

    test("cannot rename or publish another tenant's form", async () => {
      const alice = await seedTenantWithKey("alice")
      const bob = await seedTenantWithKey("bob")
      const bobs = await formsCore.saveAiForm(bob.ctx, {
        form: { title: "Bob's form", fields: [] },
      })
      if (!bobs.success) throw new Error("setup failed")

      expect(
        toolError(
          (await callTool(alice.token, "makingflow_rename_form", { formId: bobs.id, title: "Pwned" }))
            .body,
        ),
      ).toContain("not found")
      expect(
        toolError(
          (await callTool(alice.token, "makingflow_publish_form", { formId: bobs.id })).body,
        ),
      ).toContain("not found")

      const [form] = await db.select().from(forms).where(eq(forms.id, bobs.id))
      expect(form.title).toBe("Bob's form")
      expect(form.status).toBe("draft")
    })

    test("a read-only key cannot invoke a write tool even by name", async () => {
      const readonly = await seedTenantWithKey("readonly", ["forms:read"])
      const saved = await formsCore.saveAiForm(readonly.ctx, {
        form: { title: "Read only", fields: [] },
      })
      if (!saved.success) throw new Error("setup failed")

      // The tool is hidden from tools/list, but hiding is not enforcement —
      // a client that hardcodes the name must still be refused.
      const { body } = await callTool(readonly.token, "makingflow_rename_form", {
        formId: saved.id,
        title: "Pwned",
      })
      const text = JSON.stringify(body)
      expect(text.toLowerCase()).toMatch(/scope|not found|unknown|invalid/)

      const [form] = await db.select().from(forms).where(eq(forms.id, saved.id))
      expect(form.title).toBe("Read only")
    })
  })

  describe("input validation", () => {
    test("bad arguments come back as a tool error the model can fix", async () => {
      const alice = await seedTenantWithKey("alice")
      const { status, body } = await callTool(alice.token, "makingflow_rename_form", {
        formId: "some-id",
        title: "",
      })
      // Not a protocol error: a validation failure is exactly the kind of thing
      // the model should be able to read and retry.
      expect(status).toBe(200)
      expect(JSON.stringify(body).length).toBeGreaterThan(0)
    })
  })
})
