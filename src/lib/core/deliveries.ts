import { after } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { integrationDeliveries, type IntegrationDelivery } from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { claimByIds, deliverBatch } from "@/lib/integrations/webhook-delivery"

/**
 * Reading and resending deliveries, tenant-scoped.
 *
 * These lived in core/webhooks.ts while webhooks were the only thing queued.
 * Every integration goes through the queue now, so a Sheets sync's history was
 * being read through a module called "webhooks" — the kind of misleading name
 * that quietly teaches the next person the wrong model.
 *
 * The queue itself is driven from src/lib/integrations/webhook-delivery.ts,
 * which has no AuthContext because the cron sweep cannot build one. This is the
 * surface a signed-in person reaches it through.
 */

export type Result = { success: true } | { success: false; error: string }

/** One delivery as a list row. Deliberately without the payload — see below. */
export type DeliveryView = {
  id: string
  type: IntegrationDelivery["type"]
  event: string
  status: IntegrationDelivery["status"]
  attempts: number
  lastStatus: number | null
  lastError: string | null
  createdAt: Date
  deliveredAt: Date | null
  nextAttemptAt: Date
}

/** A delivery opened up: what we sent, and what came back. */
export type DeliveryDetail = DeliveryView & {
  /** Webhook only — the other integration types have no destination URL. */
  url: string | null
  payload: unknown
  responseBody: string | null
}

/**
 * How to find the deliveries someone is asking about.
 *
 * TWO SHAPES, because the integrations differ in a way that reaches this far.
 * A form can have several webhooks, so those are addressed by endpoint. Sheets,
 * Notion, email and Discord are one per form — and the first two may have no
 * integration row at all while their destination is still unprovisioned, so
 * there is no id to ask by. Those are addressed by form and type.
 */
export type DeliverySelector =
  | { integrationId: string }
  | { formId: string; type: IntegrationDelivery["type"] }

function matches(selector: DeliverySelector) {
  return "integrationId" in selector
    ? eq(integrationDeliveries.integrationId, selector.integrationId)
    : and(
        eq(integrationDeliveries.formId, selector.formId),
        eq(integrationDeliveries.type, selector.type),
      )
}

/**
 * Recent deliveries for one destination, newest first.
 *
 * The payload and the response body are NOT selected here. A list of twenty
 * deliveries would otherwise ship twenty copies of a respondent's answers to
 * the browser to render a table of statuses — the detail view fetches one when
 * someone actually opens it.
 */
export async function listDeliveries(
  ctx: AuthContext,
  selector: DeliverySelector,
  limit = 20,
): Promise<DeliveryView[]> {
  return db
    .select({
      id: integrationDeliveries.id,
      type: integrationDeliveries.type,
      event: integrationDeliveries.event,
      status: integrationDeliveries.status,
      attempts: integrationDeliveries.attempts,
      lastStatus: integrationDeliveries.lastStatus,
      lastError: integrationDeliveries.lastError,
      createdAt: integrationDeliveries.createdAt,
      deliveredAt: integrationDeliveries.deliveredAt,
      nextAttemptAt: integrationDeliveries.nextAttemptAt,
    })
    .from(integrationDeliveries)
    .where(and(matches(selector), eq(integrationDeliveries.workspaceId, ctx.workspaceId)))
    .orderBy(desc(integrationDeliveries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
}

/** One delivery in full. Another tenant's id is indistinguishable from absent. */
export async function getDelivery(
  ctx: AuthContext,
  deliveryId: string,
): Promise<DeliveryDetail | null> {
  const [row] = await db
    .select()
    .from(integrationDeliveries)
    .where(
      and(
        eq(integrationDeliveries.id, deliveryId),
        eq(integrationDeliveries.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1)
  if (!row) return null

  return {
    id: row.id,
    type: row.type,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    nextAttemptAt: row.nextAttemptAt,
    url: row.url,
    // Null for everything except a webhook, which is the only type that
    // snapshots what it sent — the rest render from the answers table.
    payload: row.payload,
    // The signing secret is never part of this, and the signature is not
    // stored: the owner holds the secret and the body, so they can recompute it.
    responseBody: row.lastResponseBody,
  }
}

/**
 * Send a finished delivery again.
 *
 * The SAME row goes back to `pending` rather than a new one being created, and
 * that is the correct semantics rather than a shortcut: a redelivery is the
 * same delivery, so it should carry the same delivery id. A receiver that
 * already processed it can then recognise the duplicate — which is precisely
 * what the id is on the wire for.
 *
 * Attempts reset to zero, so a redelivery gets the full retry ladder rather
 * than one attempt against a destination that is still coming back up.
 */
export async function redeliver(ctx: AuthContext, deliveryId: string): Promise<Result> {
  const [row] = await db
    .select({
      id: integrationDeliveries.id,
      status: integrationDeliveries.status,
      formId: integrationDeliveries.formId,
    })
    .from(integrationDeliveries)
    .where(
      and(
        eq(integrationDeliveries.id, deliveryId),
        eq(integrationDeliveries.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1)
  if (!row) return { success: false, error: "Delivery not found" }

  // Re-queueing something already queued would reset its backoff and could put
  // it in flight twice.
  if (row.status === "pending" || row.status === "sending") {
    return { success: false, error: "This delivery is already queued." }
  }

  await db
    .update(integrationDeliveries)
    .set({
      status: "pending",
      nextAttemptAt: new Date(),
      attempts: 0,
      claimToken: null,
      claimedAt: null,
      lastError: null,
    })
    .where(eq(integrationDeliveries.id, row.id))

  // Try it now rather than waiting up to a minute for the sweep. Safe to race
  // with the sweep: both go through the same claim, so whichever gets there
  // first is the only one that sends.
  after(async () => {
    const claimed = await claimByIds([row.id])
    await deliverBatch(claimed)
  })

  invalidate(ctx, { paths: [`/forms/${row.formId}/integrations`, "/integrations"] })
  return { success: true }
}
