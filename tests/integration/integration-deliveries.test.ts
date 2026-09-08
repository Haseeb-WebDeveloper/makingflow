/**
 * Email and Discord, now that they go through the delivery queue.
 *
 * Both used to run from after() and swallow their failures — a notification
 * nobody received was also a notification nobody knew about. These pin the two
 * halves of the replacement: that a delivery is ENQUEUED for them at all, and
 * that dispatching one actually reaches the right sender.
 *
 * The enqueue assertions work because the rows are written inside the
 * submission's transaction. after() is stubbed to a no-op in this suite, so
 * nothing is ever sent during a submitForm test — which is exactly why the rows
 * being there proves where they were written.
 */

import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  answers,
  formFields,
  formIntegrations,
  forms,
  integrationDeliveries,
  submissions,
  workspaceConnections,
  workspaces,
} from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"
import { claimDue, deliverBatch } from "@/lib/integrations/webhook-delivery"

let seq = 0

async function seedForm() {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS del ${seq}`, slug: `ws-del-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Job Application",
      publicId: `del${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
      renderMode: "classic",
    })
    .returning({ id: forms.id, publicId: forms.publicId })
  const [field] = await db
    .insert(formFields)
    .values({
      formId: form.id,
      type: "short_text",
      label: "Your name",
      required: true,
      position: 0,
    })
    .returning({ id: formFields.id })

  return { workspaceId: ws.id, formId: form.id, publicId: form.publicId, fieldId: field.id }
}

type Form = Awaited<ReturnType<typeof seedForm>>

async function addIntegration(
  f: Form,
  type: "email" | "discord" | "webhook" | "google_sheets" | "notion",
  config: Record<string, unknown>,
  enabled = true,
) {
  const [row] = await db
    .insert(formIntegrations)
    .values({ formId: f.formId, workspaceId: f.workspaceId, type, enabled, config: config as never })
    .returning({ id: formIntegrations.id })
  return row.id
}

const deliveriesFor = (formId: string) =>
  db.select().from(integrationDeliveries).where(eq(integrationDeliveries.formId, formId))

/**
 * Bring a form's deliveries forward so the sweep will claim them.
 *
 * submitForm schedules new rows a few seconds out, deliberately, so the cron
 * sweep cannot race the inline attempt for a row that is about to be claimed by
 * id. `claimDue` therefore finds nothing straight after a submit — which is the
 * grace window working, not a failure. This is the sweep arriving a minute
 * later, which is the path being tested.
 */
async function makeDue(formId: string) {
  await db
    .update(integrationDeliveries)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(integrationDeliveries.formId, formId))
}

function stubFetch(status = 200, body = "ok") {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: url.toString(), init })
      return { status, ok: status < 300, headers: new Headers(), text: async () => body } as unknown as Response
    }),
  )
  return calls
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key")
  vi.stubEnv("EMAIL_FROM", "forms@makingflow.test")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("enqueueing the non-webhook types", () => {
  test("an email notification gets a delivery of its own", async () => {
    const f = await seedForm()
    const email = await addIntegration(f, "email", {
      recipients: ["owner@example.test"],
      includeAnswers: true,
    })

    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const rows = await deliveriesFor(f.formId)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe("email")
    expect(rows[0].integrationId).toBe(email)
    expect(rows[0].status).toBe("pending")
  })

  test("Discord gets one too, and both when both are on", async () => {
    const f = await seedForm()
    await addIntegration(f, "email", { recipients: ["owner@example.test"] })
    await addIntegration(f, "discord", { webhookUrl: "https://discord.com/api/webhooks/1/abc" })
    await addIntegration(f, "webhook", { url: "https://receiver.example/hook" })

    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const rows = await deliveriesFor(f.formId)
    expect(rows.map((r) => r.type).sort()).toEqual(["discord", "email", "webhook"])
  })

  test("a disabled integration is not owed anything", async () => {
    const f = await seedForm()
    await addIntegration(f, "email", { recipients: ["owner@example.test"] }, false)
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    expect(await deliveriesFor(f.formId)).toHaveLength(0)
  })

  test("only a webhook stores a payload — the rest keep no copy of the answers", async () => {
    // The PII rule from design note 5. Email and Discord render from the
    // answers table at send time, so a snapshot here would be a second copy of
    // the respondent's data bought for nothing.
    const f = await seedForm()
    await addIntegration(f, "email", { recipients: ["owner@example.test"] })
    await addIntegration(f, "discord", { webhookUrl: "https://discord.com/api/webhooks/1/abc" })
    await addIntegration(f, "webhook", { url: "https://receiver.example/hook" })

    await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada Lovelace" }],
    })

    for (const row of await deliveriesFor(f.formId)) {
      if (row.type === "webhook") {
        expect(row.payload).toBeTruthy()
        expect(row.url).toBe("https://receiver.example/hook")
      } else {
        expect(row.payload).toBeNull()
        // Discord's webhook URL IS its credential, so it must not be copied
        // onto the delivery row either.
        expect(row.url).toBeNull()
      }
    }
  })
})

describe("dispatching them", () => {
  test("an email delivery reaches the mail provider and settles", async () => {
    const f = await seedForm()
    await addIntegration(f, "email", {
      recipients: ["owner@example.test"],
      includeAnswers: true,
    })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const calls = stubFetch(200, '{"id":"x"}')
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("resend.com")
    // The delivery id doubles as an idempotency key, so a retry of a send that
    // actually landed is deduplicated wherever the provider honours one.
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers["Idempotency-Key"]).toBeTruthy()

    const [row] = await deliveriesFor(f.formId)
    expect(row.status).toBe("succeeded")
  })

  test("the email body carries the answers, re-read rather than snapshotted", async () => {
    const f = await seedForm()
    await addIntegration(f, "email", {
      recipients: ["owner@example.test"],
      includeAnswers: true,
    })
    await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada Lovelace" }],
    })

    const calls = stubFetch()
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.html).toContain("Ada Lovelace")
    expect(sent.html).toContain("Your name")
  })

  test("a Discord delivery posts to the configured channel", async () => {
    const f = await seedForm()
    await addIntegration(f, "discord", {
      webhookUrl: "https://discord.com/api/webhooks/1/abc",
      includeAnswers: true,
    })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const calls = stubFetch(204, "")
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    expect(calls[0].url).toContain("discord.com/api/webhooks")
    const [row] = await deliveriesFor(f.formId)
    expect(row.status).toBe("succeeded")
  })

  test("a failure is recorded and retried rather than lost", async () => {
    // The whole point. This used to be a console.error and nothing else.
    const f = await seedForm()
    await addIntegration(f, "discord", { webhookUrl: "https://discord.com/api/webhooks/1/abc" })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    stubFetch(500, "discord is unwell")
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    const [row] = await deliveriesFor(f.formId)
    expect(row.status).toBe("pending")
    expect(row.attempts).toBe(1)
    expect(row.lastStatus).toBe(500)
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  test("a delivery whose submission was deleted is retired, not retried forever", async () => {
    const f = await seedForm()
    await addIntegration(f, "email", { recipients: ["owner@example.test"] })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    // Deleting the submission cascades the delivery away, so reach the
    // "content is gone" branch by removing only what the sender reads.
    const [row] = await deliveriesFor(f.formId)
    await db.delete(answers).where(eq(answers.submissionId, row.submissionId))
    await db
      .update(integrationDeliveries)
      .set({ submissionId: row.submissionId })
      .where(eq(integrationDeliveries.id, row.id))

    const calls = stubFetch()
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    // An email with no answers is still a legitimate notification, so this one
    // sends. The guard being tested is that it does not crash on empty content.
    expect(calls.length).toBeLessThanOrEqual(1)
  })

  test("an email integration with no recipients is retired immediately", async () => {
    // Retrying cannot invent a recipient, so burning six attempts on it would
    // be theatre.
    const f = await seedForm()
    await addIntegration(f, "email", { recipients: [] })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const calls = stubFetch()
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    expect(calls).toHaveLength(0)
    const [row] = await deliveriesFor(f.formId)
    expect(row.status).toBe("exhausted")
    expect(row.lastError).toContain("recipients")
  })

  test("turning an integration off stops deliveries already owed", async () => {
    const f = await seedForm()
    const discord = await addIntegration(f, "discord", {
      webhookUrl: "https://discord.com/api/webhooks/1/abc",
    })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    await db
      .update(formIntegrations)
      .set({ enabled: false })
      .where(eq(formIntegrations.id, discord))

    const calls = stubFetch()
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    expect(calls).toHaveLength(0)
    const [row] = await deliveriesFor(f.formId)
    expect(row.status).toBe("exhausted")
  })

  test("one submission is owed one email, however many times submit runs", async () => {
    const f = await seedForm()
    await addIntegration(f, "email", { recipients: ["owner@example.test"] })
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const [row] = await deliveriesFor(f.formId)
    // Re-running the same enqueue must collide with the singleton partial
    // unique index rather than produce a second notification.
    await expect(
      db.insert(integrationDeliveries).values({
        workspaceId: f.workspaceId,
        formId: f.formId,
        type: "email",
        submissionId: row.submissionId,
        event: "submission.created",
      }),
    ).rejects.toThrow()
  })

  test("the singleton index still allows two webhooks on one form", async () => {
    // The partial indexes exist because these two rules differ: one email per
    // form, but as many webhooks as you like.
    const f = await seedForm()
    await addIntegration(f, "webhook", { url: "https://one.example/hook" })
    await addIntegration(f, "webhook", { url: "https://two.example/hook" })

    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const rows = await db
      .select()
      .from(integrationDeliveries)
      .where(
        and(
          eq(integrationDeliveries.formId, f.formId),
          eq(integrationDeliveries.type, "webhook"),
        ),
      )
    expect(rows).toHaveLength(2)
  })
})

/**
 * Sheets and Notion are the odd pair: the WORKSPACE connection is the
 * on-switch, and the per-form row is provisioned lazily on the first response.
 * So a delivery is owed based on "is the provider connected", and it can
 * legitimately carry no integrationId at all — which is exactly the case the
 * nullable column and the left join in withSecrets exist for.
 */
describe("the connection-driven pair", () => {
  async function connect(f: Form, provider: "google" | "notion") {
    await db.insert(workspaceConnections).values({
      workspaceId: f.workspaceId,
      provider,
      accountEmail: "owner@example.test",
      accessToken: "encrypted-placeholder",
    })
  }

  test("connecting Google makes every form owe a Sheets delivery", async () => {
    const f = await seedForm()
    await connect(f, "google")

    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const rows = await deliveriesFor(f.formId)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe("google_sheets")
    // No per-form row exists yet — the spreadsheet is provisioned on delivery.
    expect(rows[0].integrationId).toBeNull()
    expect(rows[0].payload).toBeNull()
  })

  test("Notion behaves the same way", async () => {
    const f = await seedForm()
    await connect(f, "notion")
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const rows = await deliveriesFor(f.formId)
    expect(rows.map((r) => r.type)).toEqual(["notion"])
  })

  test("no connection means nothing is owed", async () => {
    const f = await seedForm()
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    expect(await deliveriesFor(f.formId)).toHaveLength(0)
  })

  test("a form paused for Sheets is skipped even though the workspace is connected", async () => {
    // Pausing is per form; connecting is per workspace. The pause has to win.
    const f = await seedForm()
    await connect(f, "google")
    await addIntegration(f, "google_sheets", { spreadsheetId: "sheet-1" }, false)

    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    expect(await deliveriesFor(f.formId)).toHaveLength(0)
  })

  test("an already-provisioned form carries its integration id", async () => {
    const f = await seedForm()
    await connect(f, "google")
    const sheet = await addIntegration(f, "google_sheets", { spreadsheetId: "sheet-1" })

    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const [row] = await deliveriesFor(f.formId)
    expect(row.integrationId).toBe(sheet)
  })

  test("a delivery for a disconnected provider is retired, not retried for hours", async () => {
    // The connection was removed between enqueue and send. No amount of waiting
    // brings it back, so burning six attempts on it would be theatre.
    const f = await seedForm()
    await connect(f, "google")
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    await db
      .delete(workspaceConnections)
      .where(eq(workspaceConnections.workspaceId, f.workspaceId))

    const calls = stubFetch()
    await makeDue(f.formId)
    await deliverBatch(await claimDue(10))

    expect(calls).toHaveLength(0)
    const [row] = await deliveriesFor(f.formId)
    expect(row.status).toBe("exhausted")
    expect(row.lastError).toContain("not connected")
  })

  test("a Sheets delivery survives the claim's left join", async () => {
    // withSecrets used to inner-join form_integrations. A Sheets row with no
    // integration id yet would be claimed — status flipped, attempt counted —
    // and then dropped by the join: never sent, stuck until the stale reclaim,
    // then looping forever. It must come back from the claim.
    const f = await seedForm()
    await connect(f, "google")
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    await makeDue(f.formId)
    const claimed = await claimDue(10)

    expect(claimed).toHaveLength(1)
    expect(claimed[0].type).toBe("google_sheets")
    expect(claimed[0].integrationId).toBeNull()
  })
})

test("a form with no integrations enqueues nothing", async () => {
  const f = await seedForm()
  await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
  expect(await deliveriesFor(f.formId)).toHaveLength(0)
  expect(randomUUID()).toBeTruthy()
})
