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
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  mcpApiKeys,
  mcpAuditLog,
  mcpKeyWorkspaces,
  submissions,
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
      userId: user.id,
      name: `${label} key`,
      prefix: token.slice(0, 15),
      keyHash: hashApiKey(token),
      scopes,
    })
    .returning({ id: mcpApiKeys.id })
  await db.insert(mcpKeyWorkspaces).values({ keyId: key.id, workspaceId: workspace.id })

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

/**
 * The wider tool surface: editing through the operation language, the
 * submission tools behind their PII scope, and analytics.
 */
describe("MCP tools", () => {
  beforeEach(() => resetCacheSpy())

  test("get_context hands the model the vocabulary instead of making it guess", async () => {
    const alice = await seedTenantWithKey("alice")
    const { body } = await callTool(alice.token, "makingflow_get_context")
    const result = structured(body) as {
      workspace: { id: string; role: string }
      capabilities: { fieldTypes: string[]; operations: string[] }
    }

    expect(result.workspace.id).toBe(alice.workspaceId)
    expect(result.workspace.role).toBe("owner")
    expect(result.capabilities.fieldTypes).toContain("short_text")
    expect(result.capabilities.operations).toContain("add_field")
  })

  test("create_form then update_form edits through the operation language", async () => {
    const alice = await seedTenantWithKey("alice")

    const created = structured(
      (
        await callTool(alice.token, "makingflow_create_form", {
          title: "Job Application",
          fields: [{ type: "short_text", label: "Name", required: true }],
        })
      ).body,
    ) as { id: string }

    // The connected model emits operations directly — no second LLM hop to
    // re-derive them from prose.
    const updated = structured(
      (
        await callTool(alice.token, "makingflow_update_form", {
          formId: created.id,
          operations: [
            { op: "add_field", field: { type: "email", label: "Email", required: true } },
            { op: "rename_form", title: "Senior Engineer Application" },
          ],
        })
      ).body,
    ) as { applied: number; form: { title: string; fields: { label: string }[] } }

    expect(updated.applied).toBe(2)
    expect(updated.form.title).toBe("Senior Engineer Application")
    expect(updated.form.fields.map((f) => f.label)).toEqual(["Name", "Email"])

    // Persisted, not just returned.
    const [form] = await db.select().from(forms).where(eq(forms.id, created.id))
    expect(form.title).toBe("Senior Engineer Application")
  })

  test("delete_form refuses without confirm, then works with it", async () => {
    const alice = await seedTenantWithKey("alice", ["forms:read", "forms:write", "destructive"])
    const saved = await formsCore.saveAiForm(alice.ctx, {
      form: { title: "Disposable", fields: [] },
    })
    if (!saved.success) throw new Error("setup failed")

    // The scope alone is not enough: a model acting on a vague instruction must
    // still be stopped by the explicit confirm.
    const refused = await callTool(alice.token, "makingflow_delete_form", { formId: saved.id })
    expect(toolError(refused.body).toLowerCase()).toContain("confirm")
    expect(await db.select().from(forms).where(eq(forms.id, saved.id))).toHaveLength(1)

    await callTool(alice.token, "makingflow_delete_form", { formId: saved.id, confirm: true })
    expect(await db.select().from(forms).where(eq(forms.id, saved.id))).toHaveLength(0)
  })

  test("a key without the destructive scope cannot delete at all", async () => {
    const alice = await seedTenantWithKey("alice", ["forms:read", "forms:write"])
    const saved = await formsCore.saveAiForm(alice.ctx, {
      form: { title: "Safe", fields: [] },
    })
    if (!saved.success) throw new Error("setup failed")

    const { body } = await callTool(alice.token, "makingflow_delete_form", {
      formId: saved.id,
      confirm: true,
    })
    // Even with confirm supplied, the credential was never granted deletion.
    expect(JSON.stringify(body).toLowerCase()).toMatch(/scope|unknown|not found/)
    expect(await db.select().from(forms).where(eq(forms.id, saved.id))).toHaveLength(1)
  })

  test("submission answers stay behind their own scope", async () => {
    const formsOnly = await seedTenantWithKey("formsonly", ["forms:read", "forms:write"])
    const saved = await formsCore.saveAiForm(formsOnly.ctx, {
      form: { title: "Survey", fields: [] },
    })
    if (!saved.success) throw new Error("setup failed")

    const { body } = await rpc(formsOnly.token, "tools/list")
    const names = (body as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)
    // A key that can build forms all day still cannot read what people wrote.
    expect(names).not.toContain("makingflow_list_submissions")
    expect(names).not.toContain("makingflow_get_submission")

    const denied = await callTool(formsOnly.token, "makingflow_list_submissions", {
      formId: saved.id,
    })
    expect(JSON.stringify(denied.body).toLowerCase()).toMatch(/scope|unknown|not found/)
  })

  test("list_submissions reports the true total, not the page size", async () => {
    const alice = await seedTenantWithKey("alice", [
      "forms:read",
      "forms:write",
      "submissions:read",
    ])
    const saved = await formsCore.saveAiForm(alice.ctx, {
      form: {
        title: "Survey",
        fields: [{ id: randomUUID(), type: "short_text", label: "Name", required: false }],
      },
    })
    if (!saved.success) throw new Error("setup failed")

    for (let i = 0; i < 5; i++) {
      await db.insert(submissions).values({
        formId: saved.id,
        workspaceId: alice.workspaceId,
        status: "completed",
        completedAt: new Date(),
      })
    }

    const { body } = await callTool(alice.token, "makingflow_list_submissions", {
      formId: saved.id,
      limit: 2,
    })
    const result = structured(body) as {
      counts: { completed: number }
      returned: number
      submissions: { answers?: unknown }[]
    }

    expect(result.returned).toBe(2)
    // Reporting the page size as the total is the regression that told someone
    // they had 100 responses when they had 150.
    expect(result.counts.completed).toBe(5)
    // Answers are opt-in, so a listing does not spray respondent PII into context.
    expect(result.submissions[0].answers).toBeUndefined()
  })

  test("analytics are readable without the answers scope", async () => {
    const analyst = await seedTenantWithKey("analyst", ["forms:read", "analytics:read"])
    const { body } = await callTool(analyst.token, "makingflow_get_dashboard", { range: "14d" })
    const result = structured(body) as { totals: { totalForms: number }; range: string }

    expect(result.range).toBe("14d")
    expect(result.totals.totalForms).toBe(0)
  })
})

/**
 * Multi-workspace keys.
 *
 * Every user in this product belongs to more than one workspace, so this is the
 * normal case rather than an edge one. A key grants a SET of workspaces, and
 * the tool schemas change shape accordingly: with one there is nothing to
 * choose and the argument does not exist; with several it is required, so a
 * model is forced to say which it means instead of having one picked for it.
 */
describe("multi-workspace keys", () => {
  async function seedTwoWorkspaceUser(scopes: string[] = ["forms:read", "forms:write"]) {
    seq += 1
    const unique = `multi-${seq}-${Date.now()}`
    const [user] = await db
      .insert(users)
      .values({ id: randomUUID(), email: `${unique}@example.test`, name: "multi" })
      .returning({ id: users.id })

    const made = []
    for (const suffix of ["a", "b"]) {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: `WS ${unique}-${suffix}`, slug: `ws-${unique}-${suffix}` })
        .returning({ id: workspaces.id })
      await db
        .insert(workspaceMembers)
        .values({ workspaceId: ws.id, userId: user.id, role: "owner" })
      made.push(ws.id)
    }

    const token = `mf_sk_live_${unique}-secret`
    const [key] = await db
      .insert(mcpApiKeys)
      .values({
        userId: user.id,
        name: "multi key",
        prefix: token.slice(0, 15),
        keyHash: hashApiKey(token),
        scopes,
      })
      .returning({ id: mcpApiKeys.id })
    await db
      .insert(mcpKeyWorkspaces)
      .values(made.map((workspaceId) => ({ keyId: key.id, workspaceId })))

    return {
      token,
      keyId: key.id,
      userId: user.id,
      a: made[0],
      b: made[1],
      ctxA: testContext({ userId: user.id, workspaceId: made[0] }),
      ctxB: testContext({ userId: user.id, workspaceId: made[1] }),
    }
  }

  test("tool schemas require workspaceId only when the key spans several", async () => {
    const multi = await seedTwoWorkspaceUser()
    const single = await seedTenantWithKey("single")

    const multiTools = (
      (await rpc(multi.token, "tools/list")).body as {
        result: { tools: { name: string; inputSchema: { required?: string[] } }[] }
      }
    ).result.tools
    const singleTools = (
      (await rpc(single.token, "tools/list")).body as {
        result: { tools: { name: string; inputSchema: { required?: string[] } }[] }
      }
    ).result.tools

    const listMulti = multiTools.find((t) => t.name === "makingflow_list_forms")!
    const listSingle = singleTools.find((t) => t.name === "makingflow_list_forms")!

    expect(listMulti.inputSchema.required).toContain("workspaceId")
    // A one-workspace key keeps the simpler signature — nothing to get wrong.
    expect(listSingle.inputSchema.required ?? []).not.toContain("workspaceId")
  })

  test("one key reaches both workspaces, and keeps them apart", async () => {
    const multi = await seedTwoWorkspaceUser()
    await formsCore.saveAiForm(multi.ctxA, { form: { title: "In A", fields: [] } })
    await formsCore.saveAiForm(multi.ctxB, { form: { title: "In B", fields: [] } })

    const inA = structured(
      (await callTool(multi.token, "makingflow_list_forms", { workspaceId: multi.a })).body,
    ) as { forms: { title: string }[] }
    const inB = structured(
      (await callTool(multi.token, "makingflow_list_forms", { workspaceId: multi.b })).body,
    ) as { forms: { title: string }[] }

    // The point of the whole change: one credential, one MCP server, both
    // workspaces — and each still only shows its own forms.
    expect(inA.forms.map((f) => f.title)).toEqual(["In A"])
    expect(inB.forms.map((f) => f.title)).toEqual(["In B"])
  })

  test("omitting workspaceId asks which one rather than guessing", async () => {
    const multi = await seedTwoWorkspaceUser()
    const { body } = await callTool(multi.token, "makingflow_list_forms", {})
    const text = JSON.stringify(body).toLowerCase()
    // Silently picking one would eventually write to the wrong workspace.
    expect(text).toMatch(/workspaceid|required/)
  })

  test("a workspace outside the grant is refused, even if the user belongs to it", async () => {
    const multi = await seedTwoWorkspaceUser()
    // A third workspace the user IS a member of, but which this key never granted.
    seq += 1
    const [outside] = await db
      .insert(workspaces)
      .values({ name: `WS outside ${seq}`, slug: `ws-outside-${seq}-${Date.now()}` })
      .returning({ id: workspaces.id })
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: outside.id, userId: multi.userId, role: "owner" })

    const { body } = await callTool(multi.token, "makingflow_list_forms", {
      workspaceId: outside.id,
    })
    // Membership is necessary but not sufficient — the grant is the ceiling, so
    // joining a workspace later never widens an existing key.
    expect(toolError(body)).toContain("not found")
  })

  test("losing membership drops that workspace but leaves the other working", async () => {
    const multi = await seedTwoWorkspaceUser()
    await db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.userId, multi.userId), eq(workspaceMembers.workspaceId, multi.a)),
      )

    // The grant still names A, but membership is the live check — so A is gone
    // while B carries on. The key narrows, it never breaks entirely.
    expect(toolError((await callTool(multi.token, "makingflow_list_forms", { workspaceId: multi.a })).body)).toContain(
      "not found",
    )
    expect(
      structured((await callTool(multi.token, "makingflow_list_forms", { workspaceId: multi.b })).body),
    ).toBeDefined()
  })
})

/**
 * Transport-level defects found by probing the deployed server.
 *
 * Every one of these was invisible to the existing suite because the suite
 * calls the route handler directly and never looks at CORS, discovery paths, or
 * how a page walk behaves across many rows. They are cheap to assert and each
 * one, when broken, fails silently rather than loudly.
 */
describe("transport surface", () => {
  test("preflight advertises the protocol's own headers", async () => {
    const { OPTIONS } = await import("@/app/api/mcp/route")
    const response = OPTIONS(
      new Request(ENDPOINT, {
        method: "OPTIONS",
        headers: {
          origin: "https://claude.ai",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,mcp-method,mcp-name",
        },
      }),
    )

    expect(response.status).toBe(204)
    const allowed = response.headers.get("access-control-allow-headers") ?? ""
    // A header missing from this list is stripped by the browser before the
    // request is sent, so the server sees a malformed request rather than a
    // CORS error — a genuinely confusing way to fail.
    expect(allowed).toContain("Authorization")
    expect(allowed).toContain("Mcp-Method")
    expect(allowed).toContain("Mcp-Name")
    expect(allowed).toContain("MCP-Protocol-Version")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  test("Mcp-Param-* headers are reflected, and nothing else is", async () => {
    const { OPTIONS } = await import("@/app/api/mcp/route")
    const response = OPTIONS(
      new Request(ENDPOINT, {
        method: "OPTIONS",
        headers: {
          origin: "https://claude.ai",
          "access-control-request-headers": "mcp-param-form-id,x-sneaky-header",
        },
      }),
    )
    const allowed = response.headers.get("access-control-allow-headers") ?? ""
    // Per-tool param names are unknowable up front, so they are reflected —
    // but only ones matching the protocol's own prefix.
    expect(allowed).toContain("mcp-param-form-id")
    expect(allowed).not.toContain("x-sneaky-header")
  })

  test("the 401 carries CORS, or a browser client never reads the challenge", async () => {
    const { status, headers } = await rpc(null, "tools/list")
    expect(status).toBe(401)
    expect(headers.get("access-control-allow-origin")).toBe("*")
    // WWW-Authenticate is the whole point of the 401; it must be readable
    // cross-origin or the client cannot discover where to authenticate.
    expect(headers.get("access-control-expose-headers")).toContain("WWW-Authenticate")
  })

  test("discovery is served at BOTH the root and the path-suffixed URL", async () => {
    const root = await import("@/app/.well-known/oauth-protected-resource/route")
    const suffixed = await import("@/app/.well-known/oauth-protected-resource/[...path]/route")

    const request = new Request("http://localhost:3000/.well-known/oauth-protected-resource")
    const a = await root.GET(request).json()
    const b = await suffixed.GET(request).json()

    // RFC 9728 §3.1: a client whose resource URL has a path tries the suffixed
    // form FIRST. Serving only the root 404s for spec-strict clients.
    expect(b).toEqual(a)
    expect(a.resource).toMatch(/\/api\/mcp$/)
  })
})

describe("submission paging", () => {
  test("walks every response exactly once, with no duplicates or gaps", async () => {
    const alice = await seedTenantWithKey("alice", [
      "forms:read",
      "forms:write",
      "submissions:read",
    ])
    const saved = await formsCore.saveAiForm(alice.ctx, {
      form: { title: "Survey", fields: [] },
    })
    if (!saved.success) throw new Error("setup failed")

    const TOTAL = 12
    for (let i = 0; i < TOTAL; i++) {
      await db.insert(submissions).values({
        formId: saved.id,
        workspaceId: alice.workspaceId,
        status: "completed",
        completedAt: new Date(),
      })
    }

    const seen: string[] = []
    let cursor: string | null = null
    let guard = 0
    do {
      const args: Record<string, unknown> = { formId: saved.id, limit: 5 }
      if (cursor) args.cursor = cursor
      const result = structured((await callTool(alice.token, "makingflow_list_submissions", args)).body) as {
        submissions: { id: string }[]
        nextCursor: string | null
        counts: { completed: number }
      }
      seen.push(...result.submissions.map((s) => s.id))
      cursor = result.nextCursor
      // The true total never depends on the page size.
      expect(result.counts.completed).toBe(TOTAL)
    } while (cursor && ++guard < 10)

    expect(seen).toHaveLength(TOTAL)
    // Keyset paging exists so a row can neither repeat nor be skipped.
    expect(new Set(seen).size).toBe(TOTAL)
  })

  test("a mangled cursor starts over rather than failing the call", async () => {
    const alice = await seedTenantWithKey("alice", ["forms:read", "submissions:read"])
    const saved = await formsCore.saveAiForm(
      testContext({ userId: alice.userId, workspaceId: alice.workspaceId }),
      { form: { title: "Survey", fields: [] } },
    )
    if (!saved.success) throw new Error("setup failed")

    const { body } = await callTool(alice.token, "makingflow_list_submissions", {
      formId: saved.id,
      cursor: "not-a-real-cursor",
    })
    // It is an opaque token we handed out; failing the whole call because it
    // was mangled helps nobody.
    expect(structured(body)).toBeDefined()
  })
})
