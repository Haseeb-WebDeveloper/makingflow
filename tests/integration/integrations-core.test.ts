/**
 * The integration cores, and the secrets they must never hand back.
 *
 * Three different credentials live in this area, and each fails differently if
 * it escapes:
 *
 *   - a webhook signing secret lets anyone forge a delivery from us
 *   - a Discord webhook URL *is* the credential — holding it means posting into
 *     the channel as the integration
 *   - a Google/Notion access or refresh token is the customer's account
 *
 * All three previously sat behind nothing but a hand-written mapping in the
 * read functions. Once an MCP tool can call these, "we happen not to return it"
 * is not good enough, so these tests assert the absence directly.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  forms,
  users,
  workspaceConnections,
  workspaces,
} from "@/lib/db/schema"
import * as webhooksCore from "@/lib/core/webhooks"
import * as notificationsCore from "@/lib/core/notifications"
import * as integrationsCore from "@/lib/core/integrations"
import { testContext } from "../helpers/context"

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
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      title: "Job Application",
      publicId: `int${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  return {
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
    workspaceId: workspace.id,
    formId: form.id,
  }
}

describe("core/webhooks", () => {
  let alice: Awaited<ReturnType<typeof seedTenant>>
  let bob: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    alice = await seedTenant("alice")
    bob = await seedTenant("bob")
  })

  test("the signing secret is stored but never read back", async () => {
    const added = await webhooksCore.addWebhook(alice.ctx, alice.formId, {
      url: "https://example.com/hook",
      secret: "super-secret-signing-key",
    })
    expect(added).toEqual({ success: true })

    // It is in the database, because deliveries need to be signed...
    const [row] = await db
      .select()
      .from(formIntegrations)
      .where(eq(formIntegrations.formId, alice.formId))
    expect(JSON.stringify(row.config)).toContain("super-secret-signing-key")

    // ...and it is not in anything a caller can see.
    const listed = await webhooksCore.listWebhooks(alice.ctx, alice.formId)
    expect(listed).toHaveLength(1)
    expect(listed[0].hasSecret).toBe(true)
    expect(JSON.stringify(listed)).not.toContain("super-secret-signing-key")
  })

  test("refuses a webhook pointed at our own infrastructure", async () => {
    for (const url of [
      "http://localhost:5432/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/internal",
    ]) {
      const result = await webhooksCore.addWebhook(alice.ctx, alice.formId, { url })
      expect(result.success).toBe(false)
    }
    // Nothing was stored, so send-test cannot be used to probe them later.
    expect(await webhooksCore.listWebhooks(alice.ctx, alice.formId)).toHaveLength(0)
  })

  test("cannot add, toggle or remove a webhook on another tenant's form", async () => {
    expect(
      await webhooksCore.addWebhook(alice.ctx, bob.formId, { url: "https://example.com/x" }),
    ).toEqual({ success: false, error: "Form not found" })

    const bobs = await webhooksCore.addWebhook(bob.ctx, bob.formId, {
      url: "https://example.com/bob",
    })
    expect(bobs.success).toBe(true)
    const [row] = await db
      .select({ id: formIntegrations.id })
      .from(formIntegrations)
      .where(eq(formIntegrations.formId, bob.formId))

    expect(await webhooksCore.toggleWebhook(alice.ctx, row.id, false)).toEqual({
      success: false,
      error: "Webhook not found",
    })
    expect(await webhooksCore.removeWebhook(alice.ctx, row.id)).toEqual({
      success: false,
      error: "Webhook not found",
    })
    // Bob's is untouched and still enabled.
    const stillThere = await webhooksCore.listWebhooks(bob.ctx, bob.formId)
    expect(stillThere).toHaveLength(1)
    expect(stillThere[0].enabled).toBe(true)
  })

  test("a webhook listing never leaks another tenant's endpoints", async () => {
    await webhooksCore.addWebhook(bob.ctx, bob.formId, { url: "https://bob-only.example/hook" })
    const alicesView = await webhooksCore.listWebhooks(alice.ctx, bob.formId)
    expect(alicesView).toEqual([])
  })
})

describe("core/notifications", () => {
  let alice: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    alice = await seedTenant("alice")
  })

  test("the Discord webhook URL is stored but only ever shown masked", async () => {
    const url = "https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz"
    expect(
      await notificationsCore.saveDiscordWebhook(alice.ctx, alice.formId, {
        webhookUrl: url,
        includeAnswers: true,
        enabled: true,
      }),
    ).toEqual({ success: true })

    const view = await notificationsCore.getDiscordWebhook(alice.ctx, alice.formId)
    expect(view.configured).toBe(true)
    // The URL IS the credential — recognisable, not usable.
    expect(view.maskedUrl).toContain("…/webhooks/123456789/")
    expect(JSON.stringify(view)).not.toContain("abcdefghijklmnopqrstuvwxyz")
  })

  test("a blank URL keeps the stored one, so a toggle need not round-trip it", async () => {
    const url = "https://discord.com/api/webhooks/999/originaltoken123"
    await notificationsCore.saveDiscordWebhook(alice.ctx, alice.formId, {
      webhookUrl: url,
      includeAnswers: false,
      enabled: true,
    })
    // The settings form sends "" because it never received the real value.
    await notificationsCore.saveDiscordWebhook(alice.ctx, alice.formId, {
      webhookUrl: "",
      includeAnswers: true,
      enabled: false,
    })

    const [row] = await db
      .select()
      .from(formIntegrations)
      .where(eq(formIntegrations.formId, alice.formId))
    expect(JSON.stringify(row.config)).toContain("originaltoken123")
    expect(row.enabled).toBe(false)
  })

  test("rejects a URL that is not a Discord webhook", async () => {
    const result = await notificationsCore.saveDiscordWebhook(alice.ctx, alice.formId, {
      webhookUrl: "https://example.com/not-discord",
      includeAnswers: false,
      enabled: true,
    })
    expect(result.success).toBe(false)
  })

  test("email recipients are parsed, deduped and readable", async () => {
    await notificationsCore.saveEmailNotification(alice.ctx, alice.formId, {
      recipients: "One@Example.com, one@example.com; two@example.com  bad-address",
      includeAnswers: true,
      enabled: true,
    })
    const view = await notificationsCore.getEmailNotification(alice.ctx, alice.formId)
    // Lowercased, deduped, invalid dropped. Recipients are PII, not secrets —
    // the owner set them and needs to see them.
    expect(view.recipients).toEqual(["one@example.com", "two@example.com"])
  })
})

describe("core/integrations", () => {
  test("describing connections never exposes the OAuth tokens", async () => {
    const alice = await seedTenant("alice")
    await db.insert(workspaceConnections).values({
      workspaceId: alice.workspaceId,
      provider: "google",
      accountEmail: "owner@example.com",
      accessToken: "ACCESS-TOKEN-SHOULD-NEVER-APPEAR",
      refreshToken: "REFRESH-TOKEN-SHOULD-NEVER-APPEAR",
    })

    const view = await integrationsCore.describeConnections(alice.ctx)
    const google = view.find((c) => c.provider === "google")
    expect(google?.connected).toBe(true)
    expect(google?.accountEmail).toBe("owner@example.com")

    // The projection is the guarantee: the tokens are not selected, so they
    // cannot reach a caller even if someone later spreads the object.
    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain("ACCESS-TOKEN-SHOULD-NEVER-APPEAR")
    expect(serialised).not.toContain("REFRESH-TOKEN-SHOULD-NEVER-APPEAR")
  })

  test("connections are per-workspace", async () => {
    const alice = await seedTenant("alice")
    const bob = await seedTenant("bob")
    await db.insert(workspaceConnections).values({
      workspaceId: bob.workspaceId,
      provider: "google",
      accountEmail: "bob@example.com",
      accessToken: "bob-token",
    })

    const alicesView = await integrationsCore.describeConnections(alice.ctx)
    expect(alicesView.every((c) => !c.connected)).toBe(true)
    expect(JSON.stringify(alicesView)).not.toContain("bob@example.com")
  })
})
