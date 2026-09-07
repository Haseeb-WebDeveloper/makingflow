"use server"

/**
 * Webhook Server Actions — the browser's entry point.
 *
 * Thin: resolve the caller from the session cookie, delegate to
 * src/lib/core/webhooks.ts. Signatures unchanged, so no component moved.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as webhooksCore from "@/lib/core/webhooks"

type Result = { success: true } | { success: false; error: string }

/** Add a webhook endpoint to a form. */
export async function addWebhook(
  formId: string,
  input: { url: string; secret?: string },
): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.addWebhook(session.ctx, formId, input)
}

/** Enable/disable a single webhook. */
export async function toggleWebhook(integrationId: string, enabled: boolean): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.toggleWebhook(session.ctx, integrationId, enabled)
}

/** Remove a webhook endpoint. */
export async function removeWebhook(integrationId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.removeWebhook(session.ctx, integrationId)
}

/** Send a sample payload to a webhook so the user can verify their endpoint. */
export async function sendTestWebhook(
  integrationId: string,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.sendTestWebhook(session.ctx, integrationId)
}

/**
 * Recent deliveries for one endpoint.
 *
 * Fetched through an action rather than a cached `src/lib/data` read: the queue
 * changes on every submission, and a cached list showing a delivery as still
 * failing after it succeeded is worse than showing nothing.
 */
export async function listWebhookDeliveries(
  integrationId: string,
): Promise<{ success: true; deliveries: webhooksCore.DeliveryView[] } | { success: false; error: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return { success: true, deliveries: await webhooksCore.listDeliveries(session.ctx, integrationId) }
}

/** One delivery in full: the body we sent and the response we got back. */
export async function getWebhookDelivery(
  deliveryId: string,
): Promise<{ success: true; delivery: webhooksCore.DeliveryDetail } | { success: false; error: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  const delivery = await webhooksCore.getDelivery(session.ctx, deliveryId)
  if (!delivery) return { success: false, error: "Delivery not found" }
  return { success: true, delivery }
}

/** Queue a finished delivery to be sent again, keeping its delivery id. */
export async function redeliverWebhook(deliveryId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.redeliver(session.ctx, deliveryId)
}
