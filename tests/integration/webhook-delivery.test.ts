/**
 * The guarantees the delivery queue exists to provide.
 *
 * Delivery used to be an action: POST, retry once 50ms later, console.error,
 * forget. A failure was both invisible and unrecoverable, and no test could
 * have caught that because there was nothing to assert on.
 *
 * These tests pin the four properties that replaced it, in rough order of how
 * badly each one hurts when it silently stops holding:
 *
 *   1. Two senders never send the same delivery. The inline attempt and the
 *      cron sweep genuinely run at the same moment.
 *   2. A worker that dies does not strand a delivery forever.
 *   3. A stale worker that wakes up cannot overwrite the state of the run that
 *      owns the row now.
 *   4. Deleting a submission destroys the copy of the answers we snapshotted.
 *
 * Note what makes these testable at all: tests/setup-integration.ts stubs
 * after() to a no-op, so the inline attempt never fires. The delivery rows are
 * written inside the submission's transaction, so they are there to assert on
 * regardless — which is exactly the property being relied upon.
 */

import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
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
import {
  MAX_ATTEMPTS,
  claimByIds,
  claimDue,
  deliverBatch,
  reclaimStale,
} from "@/lib/integrations/webhook-delivery"
import * as webhooksCore from "@/lib/core/webhooks"
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
      publicId: `whd${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id, publicId: forms.publicId })
  const [submission] = await db
    .insert(submissions)
    .values({ formId: form.id, workspaceId: workspace.id, status: "completed" })
    .returning({ id: submissions.id })

  return {
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
    workspaceId: workspace.id,
    formId: form.id,
    publicId: form.publicId,
    submissionId: submission.id,
  }
}

type Tenant = Awaited<ReturnType<typeof seedTenant>>

async function seedEndpoint(t: Tenant, url: string, opts: { enabled?: boolean; secret?: string } = {}) {
  const [row] = await db
    .insert(formIntegrations)
    .values({
      formId: t.formId,
      workspaceId: t.workspaceId,
      type: "webhook",
      enabled: opts.enabled ?? true,
      config: opts.secret ? { url, secret: opts.secret } : { url },
    })
    .returning({ id: formIntegrations.id })
  return row.id
}

/**
 * Another response on the same form.
 *
 * Needed wherever a test wants several deliveries to one endpoint: the unique
 * (integration, submission, event) index means one endpoint is owed a given
 * submission exactly once, so N deliveries require N submissions.
 */
async function anotherSubmission(t: Tenant): Promise<string> {
  const [row] = await db
    .insert(submissions)
    .values({ formId: t.formId, workspaceId: t.workspaceId, status: "completed" })
    .returning({ id: submissions.id })
  return row.id
}

/** A delivery already due, as the cron sweep would find it. */
async function seedDelivery(
  t: Tenant,
  integrationId: string,
  overrides: Partial<typeof webhookDeliveries.$inferInsert> = {},
) {
  const payload: WebhookDeliveryPayload = {
    event: "submission.created",
    form: { id: t.formId, title: "Job Application", publicId: t.publicId },
    submission: { id: t.submissionId, submittedAt: new Date().toISOString() },
    answers: [{ fieldId: randomUUID(), question: "Name", value: "Ada" }],
  }
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      workspaceId: t.workspaceId,
      formId: t.formId,
      integrationId,
      submissionId: t.submissionId,
      event: "submission.created",
      url: "https://receiver.example/hook",
      payload,
      nextAttemptAt: new Date(Date.now() - 1000),
      ...overrides,
    })
    .returning({ id: webhookDeliveries.id })
  return row.id
}

const read = async (id: string) => {
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id))
  return row
}

/** Stub fetch with a fixed response, recording what was sent. */
function stubFetch(status: number, body = "ok") {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: url.toString(), init })
      return {
        status,
        headers: new Headers(),
        text: async () => body,
      } as unknown as Response
    }),
  )
  return calls
}

let alice: Tenant

beforeEach(async () => {
  alice = await seedTenant("alice")
})

afterEach(() => vi.unstubAllGlobals())

describe("claiming", () => {
  test("two concurrent sweeps never take the same delivery", async () => {
    // THE test in this file. The inline attempt and the cron sweep genuinely
    // overlap in production, and `prepare: false` with max: 5 means these two
    // calls land on different backends — a real race, not a simulation.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const ids = new Set<string>()
    for (let i = 0; i < 12; i += 1) {
      ids.add(await seedDelivery(alice, endpoint, { submissionId: await anotherSubmission(alice) }))
    }

    const [first, second] = await Promise.all([claimDue(20), claimDue(20)])

    const firstIds = first.map((r) => r.id)
    const secondIds = second.map((r) => r.id)
    const overlap = firstIds.filter((id) => secondIds.includes(id))

    expect(overlap).toEqual([])
    expect(new Set([...firstIds, ...secondIds])).toEqual(ids)
  })

  test("a claim counts as an attempt, so a delivery that kills its worker still ends", async () => {
    // Incremented at claim rather than on completion: a payload that reliably
    // crashes the runner must still burn attempts and reach `exhausted`, or it
    // loops forever on reclaim.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)

    await claimDue(10)

    const row = await read(id)
    expect(row.attempts).toBe(1)
    expect(row.status).toBe("sending")
    expect(row.claimToken).not.toBeNull()
  })

  test("nothing not yet due is claimed", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    await seedDelivery(alice, endpoint, { nextAttemptAt: new Date(Date.now() + 60_000) })
    expect(await claimDue(10)).toHaveLength(0)
  })

  test("claiming by id ignores the schedule, so the inline attempt can act early", async () => {
    // New deliveries are written slightly in the future to keep the sweep away
    // from them; the inline path must still be able to take them immediately.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint, {
      nextAttemptAt: new Date(Date.now() + 15_000),
    })
    const claimed = await claimByIds([id])
    expect(claimed.map((r) => r.id)).toEqual([id])
  })

  test("a delivery already claimed cannot be claimed again by id", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    await claimDue(10)
    expect(await claimByIds([id])).toHaveLength(0)
  })
})

describe("recovering from a dead worker", () => {
  test("a stale claim goes back into circulation", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    await claimDue(10)
    // Backdate the claim past the stale window, as a crashed worker would leave it.
    await db
      .update(webhookDeliveries)
      .set({ claimedAt: sql`now() - interval '10 minutes'` })
      .where(eq(webhookDeliveries.id, id))

    expect(await reclaimStale()).toBe(1)
    expect((await read(id)).status).toBe("pending")
  })

  test("a claim still inside the window is left alone", async () => {
    // The rule that keeps a running sweep's rows from being stolen out from
    // under it — which would send the delivery twice, simultaneously.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    await claimDue(10)

    expect(await reclaimStale()).toBe(0)
    expect((await read(id)).status).toBe("sending")
  })

  test("a stale worker cannot overwrite the run that owns the row now", async () => {
    // The fencing token. Without it, a worker that stalled past the reclaim
    // window wakes and writes its own outcome over the state of the run that
    // legitimately holds the delivery.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)

    const [zombie] = await claimDue(10)
    await db
      .update(webhookDeliveries)
      .set({ claimedAt: sql`now() - interval '10 minutes'` })
      .where(eq(webhookDeliveries.id, id))
    await reclaimStale()
    const [current] = await claimDue(10)

    expect(current.claimToken).not.toBe(zombie.claimToken)

    // The zombie now finishes its long-dead attempt.
    stubFetch(200)
    await deliverBatch([zombie])

    // Its write was dropped: the row still belongs to the current claim.
    const row = await read(id)
    expect(row.status).toBe("sending")
    expect(row.claimToken).toBe(current.claimToken)
  })
})

describe("sending", () => {
  test("a 2xx marks the delivery delivered", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    stubFetch(200)

    await deliverBatch(await claimDue(10))

    const row = await read(id)
    expect(row.status).toBe("succeeded")
    expect(row.lastStatus).toBe(200)
    expect(row.deliveredAt).not.toBeNull()
    expect(row.claimToken).toBeNull()
  })

  test("a 500 is requeued with a later attempt time, not dropped", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    stubFetch(500, "kaboom")

    await deliverBatch(await claimDue(10))

    const row = await read(id)
    expect(row.status).toBe("pending")
    expect(row.attempts).toBe(1)
    expect(row.lastStatus).toBe(500)
    expect(row.lastResponseBody).toBe("kaboom")
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  test("a redirect is a failure and is never followed", async () => {
    // Load-bearing: the URL is checked against the private-range denylist, and
    // a 302 to 169.254.169.254 would walk straight past that check.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    const calls = stubFetch(302, "")

    await deliverBatch(await claimDue(10))

    expect(calls[0].init.redirect).toBe("manual")
    const row = await read(id)
    expect(row.status).toBe("pending")
    expect(row.lastStatus).toBe(302)
  })

  test("gives up after the last attempt", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    stubFetch(500)

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(webhookDeliveries.id, id))
      await deliverBatch(await claimDue(10))
    }

    const row = await read(id)
    expect(row.status).toBe("exhausted")
    expect(row.attempts).toBe(MAX_ATTEMPTS)
    // And an exhausted delivery is not picked up again.
    expect(await claimDue(10)).toHaveLength(0)
  })

  test("an internal address is refused at send time, not just at save time", async () => {
    // Written straight into the table, bypassing addWebhook's guard — which is
    // exactly the shape of a row stored before that guard existed.
    const endpoint = await seedEndpoint(alice, "http://169.254.169.254/latest/meta-data")
    const id = await seedDelivery(alice, endpoint, {
      url: "http://169.254.169.254/latest/meta-data",
    })
    const calls = stubFetch(200)

    await deliverBatch(await claimDue(10))

    expect(calls).toHaveLength(0)
    const row = await read(id)
    // Terminal, not retried: waiting does not make a link-local address valid.
    expect(row.status).toBe("exhausted")
  })

  test("a disabled endpoint stops deliveries that were already owed", async () => {
    // Otherwise "pause" means "pause new ones and keep firing the backlog for
    // the next eight hours", which is not what the toggle says.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    await db
      .update(formIntegrations)
      .set({ enabled: false })
      .where(eq(formIntegrations.id, endpoint))
    const calls = stubFetch(200)

    await deliverBatch(await claimDue(10))

    expect(calls).toHaveLength(0)
    expect((await read(id)).status).toBe("exhausted")
  })

  test("signs with the endpoint's CURRENT secret and keeps one delivery id across attempts", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook", {
      secret: "whsec_original",
    })
    const id = await seedDelivery(alice, endpoint)

    const first = stubFetch(500)
    await deliverBatch(await claimDue(10))
    const firstHeaders = first[0].init.headers as Record<string, string>
    expect(firstHeaders["X-MakingFlow-Delivery-Id"]).toBe(id)
    expect(firstHeaders["X-MakingFlow-Signature-V2"]).toContain("t=")

    // Rotate the secret, then retry.
    await db
      .update(formIntegrations)
      .set({ config: { url: "https://receiver.example/hook", secret: "whsec_rotated" } })
      .where(eq(formIntegrations.id, endpoint))
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(webhookDeliveries.id, id))

    vi.unstubAllGlobals()
    const second = stubFetch(200)
    await deliverBatch(await claimDue(10))
    const secondHeaders = second[0].init.headers as Record<string, string>

    // Same delivery — so a receiver can still recognise the duplicate — but
    // signed with the rotated secret, which is what rotating one is for.
    expect(secondHeaders["X-MakingFlow-Delivery-Id"]).toBe(id)
    expect(secondHeaders["X-MakingFlow-Signature-V2"]).not.toBe(
      firstHeaders["X-MakingFlow-Signature-V2"],
    )
  })
})

describe("tenancy and retention", () => {
  test("deleting a submission destroys the copy of its answers", async () => {
    // The GDPR assertion. `payload` is the only place outside
    // submissions/answers/uploads holding respondent data, and the cascade is
    // what bounds it — see design note 5 in the schema.
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)

    await db.delete(submissions).where(eq(submissions.id, alice.submissionId))

    expect(await read(id)).toBeUndefined()
  })

  test("removing an endpoint removes its history", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)

    await db.delete(formIntegrations).where(eq(formIntegrations.id, endpoint))

    expect(await read(id)).toBeUndefined()
  })

  test("one event is owed to one endpoint exactly once", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    await seedDelivery(alice, endpoint)

    await expect(seedDelivery(alice, endpoint)).rejects.toThrow()
  })

  test("another tenant cannot read or redeliver a delivery", async () => {
    const bob = await seedTenant("bob")
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint, { status: "exhausted" })

    expect(await webhooksCore.getDelivery(bob.ctx, id)).toBeNull()
    expect(await webhooksCore.listDeliveries(bob.ctx, endpoint)).toEqual([])
    expect(await webhooksCore.redeliver(bob.ctx, id)).toEqual({
      success: false,
      error: "Delivery not found",
    })
    // And the row is untouched by the attempt.
    expect((await read(id)).status).toBe("exhausted")
  })

  test("redeliver requeues a finished delivery, keeping its id", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint, {
      status: "exhausted",
      attempts: MAX_ATTEMPTS,
    })

    expect(await webhooksCore.redeliver(alice.ctx, id)).toEqual({ success: true })

    const row = await read(id)
    expect(row.id).toBe(id)
    expect(row.status).toBe("pending")
    // The full ladder again — one attempt against a receiver that is still
    // coming back up would be no better than the first time.
    expect(row.attempts).toBe(0)
  })

  test("redeliver refuses something already queued", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    const id = await seedDelivery(alice, endpoint)
    const result = await webhooksCore.redeliver(alice.ctx, id)
    expect(result).toEqual({ success: false, error: "This delivery is already queued." })
  })

  test("a delivery listing never exposes the signing secret", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook", {
      secret: "whsec_must_not_leak",
    })
    const id = await seedDelivery(alice, endpoint)

    const listed = await webhooksCore.listDeliveries(alice.ctx, endpoint)
    const detail = await webhooksCore.getDelivery(alice.ctx, id)

    expect(JSON.stringify(listed)).not.toContain("whsec_must_not_leak")
    expect(JSON.stringify(detail)).not.toContain("whsec_must_not_leak")
  })

  test("a listing does not ship the payload to render a table of statuses", async () => {
    const endpoint = await seedEndpoint(alice, "https://receiver.example/hook")
    await seedDelivery(alice, endpoint)

    const listed = await webhooksCore.listDeliveries(alice.ctx, endpoint)
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty("payload")
    // The detail view is where the answers live, fetched one at a time.
    expect((await webhooksCore.getDelivery(alice.ctx, listed[0].id))?.payload).toBeTruthy()
  })
})

describe("the delivery is scoped to its endpoint", () => {
  test("one endpoint's history does not include another's", async () => {
    const first = await seedEndpoint(alice, "https://one.example/hook")
    const second = await seedEndpoint(alice, "https://two.example/hook")
    await seedDelivery(alice, first)
    await seedDelivery(alice, second)

    const listed = await webhooksCore.listDeliveries(alice.ctx, first)
    expect(listed).toHaveLength(1)

    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, listed[0].id),
          eq(webhookDeliveries.integrationId, first),
        ),
      )
    expect(row).toBeTruthy()
  })
})
