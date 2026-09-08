/**
 * Webhook endpoints on a form, transport-agnostic.
 *
 * TWO THINGS THAT ARE NOT OPTIONAL HERE.
 *
 * The signing secret is write-only. `WebhookIntegrationConfig.secret` is what
 * lets a receiver prove a delivery came from us; handing it back in a read
 * would let anyone who can call a tool forge our signature. Reads report
 * `hasSecret: boolean`, which is what `getFormWebhooks` already does.
 *
 * The destination URL goes through `checkOutboundUrl`. The old check accepted
 * any http(s) host, which was fine when the only way to set one was a human
 * typing their own endpoint into a browser. A model can be talked into pointing
 * it at internal infrastructure, and `sendTest` returns the HTTP status of
 * whatever it reached.
 */

import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  integrationDeliveries,
  type IntegrationDelivery,
  type WebhookIntegrationConfig,
} from "@/lib/db/schema"
import { postWebhook, type SubmissionPayload } from "@/lib/integrations/webhook"
import { deliveryHeaders } from "@/lib/integrations/webhook-signature"
import { claimByIds, deliverBatch } from "@/lib/integrations/webhook-delivery"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { assertOwnedForm } from "@/lib/core/tenancy"
import { checkOutboundUrl } from "@/lib/core/outbound-url"

export type Result = { success: true } | { success: false; error: string }
export type TestResult = { success: boolean; status?: number; error?: string }

/** A webhook as it is safe to show — never the secret, never a bare config. */
export type WebhookView = {
  id: string
  url: string
  enabled: boolean
  hasSecret: boolean
}

function refresh(ctx: AuthContext, formId: string) {
  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
}

/** Resolve one webhook the caller's workspace owns. */
async function ownedWebhook(ctx: AuthContext, integrationId: string) {
  const [row] = await db
    .select({
      id: formIntegrations.id,
      formId: formIntegrations.formId,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listWebhooks(ctx: AuthContext, formId: string): Promise<WebhookView[]> {
  const rows = await db
    .select({
      id: formIntegrations.id,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )

  return rows.map((r) => {
    const cfg = r.config as WebhookIntegrationConfig
    return {
      id: r.id,
      url: cfg.url,
      enabled: r.enabled,
      // Presence, never the value.
      hasSecret: Boolean(cfg.secret),
    }
  })
}

export async function addWebhook(
  ctx: AuthContext,
  formId: string,
  input: { url: string; secret?: string },
): Promise<Result> {
  const owned = await assertOwnedForm(ctx, formId)
  if (!owned.ok) return { success: false, error: owned.error }

  const checked = checkOutboundUrl(input.url)
  if (!checked.ok) return { success: false, error: checked.error }

  const config: WebhookIntegrationConfig = { url: checked.url }
  const secret = input.secret?.trim()
  if (secret) config.secret = secret

  await db.insert(formIntegrations).values({
    formId: owned.row.id,
    workspaceId: ctx.workspaceId,
    type: "webhook",
    enabled: true,
    config,
  })

  refresh(ctx, owned.row.id)
  return { success: true }
}

export async function toggleWebhook(
  ctx: AuthContext,
  integrationId: string,
  enabled: boolean,
): Promise<Result> {
  const [row] = await db
    .update(formIntegrations)
    .set({ enabled })
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .returning({ formId: formIntegrations.formId })
  if (!row) return { success: false, error: "Webhook not found" }

  refresh(ctx, row.formId)
  return { success: true }
}

export async function removeWebhook(ctx: AuthContext, integrationId: string): Promise<Result> {
  const [row] = await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .returning({ formId: formIntegrations.formId })
  if (!row) return { success: false, error: "Webhook not found" }

  refresh(ctx, row.formId)
  return { success: true }
}

/** Send a sample payload so the owner can verify their endpoint receives it. */
export async function sendTestWebhook(
  ctx: AuthContext,
  integrationId: string,
): Promise<TestResult> {
  const row = await ownedWebhook(ctx, integrationId)
  if (!row) return { success: false, error: "Webhook not found" }

  const cfg = row.config as WebhookIntegrationConfig

  // Re-check at send time, not only at save time. A URL stored before this
  // guard existed, or one whose host now resolves somewhere it should not,
  // must not be reachable just because it is already in the table.
  const checked = checkOutboundUrl(cfg.url)
  if (!checked.ok) return { success: false, error: checked.error }

  const [form] = await db
    .select({ title: forms.title, publicId: forms.publicId })
    .from(forms)
    .where(eq(forms.id, row.formId))
    .limit(1)

  const sample: SubmissionPayload = {
    event: "submission.created",
    form: { id: row.formId, title: form?.title ?? "Test form", publicId: form?.publicId ?? "test" },
    submission: { id: "test_submission", submittedAt: new Date().toISOString() },
    answers: [{ fieldId: "test_field", question: "Sample question", value: "Sample answer" }],
  }

  // A test is not recorded as a delivery — there is no submission behind it and
  // nothing to retry — but it must be signed and shaped EXACTLY like a real
  // one, or "the test worked" stops being evidence that a real delivery will.
  // `randomUUID` stands in for the delivery id a stored delivery would carry.
  const body = JSON.stringify({ ...sample, test: true })
  const res = await postWebhook(
    checked.url,
    body,
    deliveryHeaders({
      deliveryId: randomUUID(),
      event: sample.event,
      body,
      secret: cfg.secret,
    }),
  )
  return { success: res.ok, status: res.status, error: res.error }
}

// ─── Delivery history ──────────────────────────────────────────────────────
//
// Reads and one write over the delivery queue, tenant-scoped. The queue itself
// is driven from src/lib/integrations/webhook-delivery.ts, which has no
// AuthContext because the cron sweep cannot build one; these are the functions
// a signed-in person reaches it through.

/** One delivery as a list row. Deliberately without the payload — see below. */
export type DeliveryView = {
  id: string
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
 * Recent deliveries for one endpoint.
 *
 * The payload and the response body are NOT selected here. A list of twenty
 * deliveries would otherwise ship twenty copies of a respondent's answers to
 * the browser to render a table of statuses — the detail view fetches one when
 * someone actually opens it.
 */
export async function listDeliveries(
  ctx: AuthContext,
  integrationId: string,
  limit = 20,
): Promise<DeliveryView[]> {
  return db
    .select({
      id: integrationDeliveries.id,
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
    .where(
      and(
        eq(integrationDeliveries.integrationId, integrationId),
        eq(integrationDeliveries.workspaceId, ctx.workspaceId),
      ),
    )
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
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    nextAttemptAt: row.nextAttemptAt,
    url: row.url,
    payload: row.payload,
    // The signing secret is never part of this, and the signature is not stored
    // — the owner holds the secret and the body, so they can recompute it.
    responseBody: row.lastResponseBody,
  }
}

/**
 * Send a finished delivery again.
 *
 * The SAME row goes back to `pending` rather than a new one being created, and
 * that is the correct semantics rather than a shortcut: a redelivery is the
 * same delivery, so it must keep its delivery id. A receiver that already
 * processed it can then recognise the duplicate and discard it — which is the
 * entire reason the id is on the wire.
 *
 * Attempts reset to zero, so a redelivery gets the full retry ladder rather
 * than one attempt on an endpoint that is still coming back up.
 */
export async function redeliver(ctx: AuthContext, deliveryId: string): Promise<Result> {
  const [row] = await db
    .select({ id: integrationDeliveries.id, status: integrationDeliveries.status, formId: integrationDeliveries.formId })
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

  refresh(ctx, row.formId)
  return { success: true }
}
