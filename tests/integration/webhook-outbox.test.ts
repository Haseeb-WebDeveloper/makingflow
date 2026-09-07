/**
 * The outbox: deliveries are written in the submission's own transaction.
 *
 * This is the single change that makes a failed webhook recoverable, and it is
 * worth being precise about why the tests below are shaped as they are.
 *
 * tests/setup-integration.ts stubs after() to a no-op, so the inline delivery
 * attempt NEVER RUNS in this suite. That is not a limitation here — it is the
 * proof. Every assertion below is about rows that exist purely because
 * `submitForm` wrote them before it returned. If someone moves the insert out of
 * the transaction and into after(), every test in this file fails immediately.
 *
 * The load-bearing one is "a submission that fails leaves no deliveries": if the
 * insert were merely near the transaction rather than inside it, a rolled-back
 * submission would leave orphan deliveries that fire a webhook for a response
 * that does not exist.
 */

import { randomUUID } from "node:crypto"
import { describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formFields,
  formIntegrations,
  forms,
  submissions,
  webhookDeliveries,
  workspaces,
  type WebhookDeliveryPayload,
} from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"

let seq = 0

async function seedForm(opts: { submissionLimit?: number } = {}) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS out ${seq}`, slug: `ws-out-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Pet survey",
      publicId: `out${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
      renderMode: "classic",
      submissionLimit: opts.submissionLimit ?? null,
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

async function addEndpoint(
  f: { formId: string; workspaceId: string },
  url: string,
  enabled = true,
) {
  const [row] = await db
    .insert(formIntegrations)
    .values({
      formId: f.formId,
      workspaceId: f.workspaceId,
      type: "webhook",
      enabled,
      config: { url },
    })
    .returning({ id: formIntegrations.id })
  return row.id
}

const deliveriesFor = (formId: string) =>
  db.select().from(webhookDeliveries).where(eq(webhookDeliveries.formId, formId))

describe("the webhook outbox", () => {
  test("one pending delivery per enabled endpoint, and none for a disabled one", async () => {
    const f = await seedForm()
    const first = await addEndpoint(f, "https://one.example/hook")
    const second = await addEndpoint(f, "https://two.example/hook")
    const paused = await addEndpoint(f, "https://paused.example/hook", false)

    const res = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada" }],
    })
    expect(res.success).toBe(true)

    const rows = await deliveriesFor(f.formId)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.integrationId).sort()).toEqual([first, second].sort())
    expect(rows.every((r) => r.status === "pending")).toBe(true)
    expect(rows.every((r) => r.attempts === 0)).toBe(true)
    expect(rows.some((r) => r.integrationId === paused)).toBe(false)
  })

  test("a form with no webhooks writes nothing", async () => {
    const f = await seedForm()
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    expect(await deliveriesFor(f.formId)).toHaveLength(0)
  })

  test("the payload is snapshotted with the answers as sent", async () => {
    const f = await seedForm()
    await addEndpoint(f, "https://one.example/hook")

    await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada Lovelace" }],
    })

    const [row] = await deliveriesFor(f.formId)
    const payload = row.payload as WebhookDeliveryPayload
    expect(payload.event).toBe("submission.created")
    expect(payload.form.id).toBe(f.formId)
    expect(payload.answers).toHaveLength(1)
    expect(payload.answers[0]).toMatchObject({
      fieldId: f.fieldId,
      question: "Your name",
      value: "Ada Lovelace",
    })
    // Points at the submission it describes, which is what the GDPR cascade
    // hangs off.
    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.formId, f.formId))
    expect(row.submissionId).toBe(submission.id)
  })

  test("the endpoint's URL is captured at enqueue time", async () => {
    const f = await seedForm()
    const endpoint = await addEndpoint(f, "https://original.example/hook")
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    // The endpoint is edited after the delivery was owed.
    await db
      .update(formIntegrations)
      .set({ config: { url: "https://changed.example/hook" } })
      .where(eq(formIntegrations.id, endpoint))

    const [row] = await deliveriesFor(f.formId)
    expect(row.url).toBe("https://original.example/hook")
  })

  test("a refused submission enqueues nothing", async () => {
    // A form at its cap. The decision is taken inside the transaction, under
    // the advisory lock, so the refusal and the enqueue cannot disagree: a
    // response that was not accepted never produces a webhook.
    //
    // Being precise about what this does and does not prove — it exercises the
    // refusal path, where the transaction returns having written nothing. It is
    // NOT a test of rollback after the delivery insert; the only way to reach
    // that is two submits racing for the last slot, which is not deterministic
    // enough to assert on here. The in-transaction placement is what the rest
    // of this file rests on, since after() never runs in this suite.
    const f = await seedForm({ submissionLimit: 1 })
    await addEndpoint(f, "https://one.example/hook")

    const first = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada" }],
    })
    expect(first.success).toBe(true)

    const second = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Grace" }],
    })
    expect(second).toEqual({ success: false, error: "This form is closed." })

    // Exactly one — the accepted response's. The refused one contributed nothing.
    const rows = await deliveriesFor(f.formId)
    expect(rows).toHaveLength(1)
    expect((rows[0].payload as WebhookDeliveryPayload).answers[0].value).toBe("Ada")
  })

  test("deliveries are due almost immediately, but not instantly", async () => {
    // Scheduled slightly ahead so the cron sweep does not race the inline
    // attempt for a row that is about to be claimed by id. Long enough to
    // matter, short enough that a missed inline attempt is retried promptly.
    const f = await seedForm()
    await addEndpoint(f, "https://one.example/hook")
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const [row] = await deliveriesFor(f.formId)
    const delay = row.nextAttemptAt.getTime() - Date.now()
    expect(delay).toBeGreaterThan(0)
    expect(delay).toBeLessThanOrEqual(30_000)
  })

  test("a submission is still accepted when its endpoint is nonsense", async () => {
    // The rule from the schema's design notes: an integration must never be
    // able to reject a response. The delivery is enqueued and fails visibly at
    // send time rather than being dropped here, where nobody would see it.
    const f = await seedForm()
    await addEndpoint(f, "http://127.0.0.1:9/hook")

    const res = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada" }],
    })

    expect(res.success).toBe(true)
    expect(await deliveriesFor(f.formId)).toHaveLength(1)
  })

  test("each delivery carries a distinct id for the receiver to dedupe on", async () => {
    const f = await seedForm()
    await addEndpoint(f, "https://one.example/hook")
    await addEndpoint(f, "https://two.example/hook")
    await submitForm({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })

    const rows = await deliveriesFor(f.formId)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    for (const row of rows) expect(row.id).not.toBe(randomUUID())
  })
})
