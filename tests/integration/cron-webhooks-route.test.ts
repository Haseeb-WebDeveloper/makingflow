/**
 * The retry sweep's HTTP entry point.
 *
 * It is reached by a Postgres cron job over the public internet with nothing
 * but a shared secret, so the auth check is the only thing between the open web
 * and a route that drains the delivery queue.
 *
 * The subtle one is the last test in this file. pg_net is fire-and-forget: it
 * records our response body and nothing else, and pg_cron marks the job
 * `succeeded` even when the route 500s. So a sweep that deferred its work with
 * after() would return an empty 200 and appear healthy while delivering
 * nothing. Asserting that the response reports real work is what keeps that
 * honest — and it only passes because the route works inline, since after() is
 * stubbed to a no-op in this suite.
 */

import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  forms,
  submissions,
  users,
  webhookDeliveries,
  workspaces,
  type WebhookDeliveryPayload,
} from "@/lib/db/schema"

const SECRET = "cron_secret_for_tests"
let seq = 0

async function seedDueDelivery() {
  seq += 1
  const unique = `cron-${seq}-${Date.now()}`
  await db
    .insert(users)
    .values({ id: randomUUID(), email: `${unique}@example.test`, name: "cron" })
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `WS ${unique}`, slug: `ws-${unique}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      title: "Job Application",
      publicId: `crn${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id, publicId: forms.publicId })
  const [submission] = await db
    .insert(submissions)
    .values({ formId: form.id, workspaceId: workspace.id, status: "completed" })
    .returning({ id: submissions.id })
  const [endpoint] = await db
    .insert(formIntegrations)
    .values({
      formId: form.id,
      workspaceId: workspace.id,
      type: "webhook",
      enabled: true,
      config: { url: "https://receiver.example/hook" },
    })
    .returning({ id: formIntegrations.id })

  const payload: WebhookDeliveryPayload = {
    event: "submission.created",
    form: { id: form.id, title: "Job Application", publicId: form.publicId },
    submission: { id: submission.id, submittedAt: new Date().toISOString() },
    answers: [],
  }
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      workspaceId: workspace.id,
      formId: form.id,
      integrationId: endpoint.id,
      submissionId: submission.id,
      event: "submission.created",
      url: "https://receiver.example/hook",
      payload,
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    .returning({ id: webhookDeliveries.id })

  return delivery.id
}

function sweep(authorization?: string) {
  return new Request("http://localhost:3000/api/cron/webhooks", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  })
}

const status = async (id: string) => {
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id))
  return row?.status
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status: 200, headers: new Headers(), text: async () => "ok" }) as unknown as Response),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/cron/webhooks", () => {
  test("refuses a request with no credential, and moves nothing", async () => {
    const id = await seedDueDelivery()
    const { POST } = await import("@/app/api/cron/webhooks/route")

    const response = await POST(sweep())

    expect(response.status).toBe(401)
    // The delivery is untouched — a rejected sweep must not half-run.
    expect(await status(id)).toBe("pending")
  })

  test("refuses a wrong secret", async () => {
    const id = await seedDueDelivery()
    const { POST } = await import("@/app/api/cron/webhooks/route")

    const response = await POST(sweep(`Bearer ${"x".repeat(SECRET.length)}`))

    expect(response.status).toBe(401)
    expect(await status(id)).toBe("pending")
  })

  test("delivers what is due and says so in the body", async () => {
    const id = await seedDueDelivery()
    const { POST } = await import("@/app/api/cron/webhooks/route")

    const response = await POST(sweep(`Bearer ${SECRET}`))
    const summary = await response.json()

    expect(response.status).toBe(200)
    expect(await status(id)).toBe("succeeded")

    // The body is the ONLY diagnostic pg_net records, and pg_cron reports the
    // job as succeeded regardless of what we return. An empty 200 here would
    // make a sweep that silently does nothing indistinguishable from a healthy
    // one — so the counts have to be real.
    expect(summary).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
  })

  test("is a no-op when there is nothing due", async () => {
    const { POST } = await import("@/app/api/cron/webhooks/route")
    const response = await POST(sweep(`Bearer ${SECRET}`))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ claimed: 0, sent: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  test("does not touch a delivery scheduled for later", async () => {
    const id = await seedDueDelivery()
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() + 60_000) })
      .where(eq(webhookDeliveries.id, id))

    const { POST } = await import("@/app/api/cron/webhooks/route")
    await POST(sweep(`Bearer ${SECRET}`))

    expect(await status(id)).toBe("pending")
    expect(fetch).not.toHaveBeenCalled()
  })
})
