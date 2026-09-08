"use server"

/**
 * Delivery history for the browser.
 *
 * Thin, like every action: resolve the caller from the session cookie and
 * delegate to src/lib/core/deliveries.ts.
 *
 * Reached through actions rather than a cached `src/lib/data` read on purpose.
 * Delivery state changes on every submission and every retry, and a cached list
 * showing a delivery as still failing after it succeeded is worse than showing
 * nothing — someone opens this precisely when they distrust what they are
 * seeing.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as deliveriesCore from "@/lib/core/deliveries"

type Result = { success: true } | { success: false; error: string }

export async function listDeliveries(
  selector: deliveriesCore.DeliverySelector,
): Promise<
  { success: true; deliveries: deliveriesCore.DeliveryView[] } | { success: false; error: string }
> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return {
    success: true,
    deliveries: await deliveriesCore.listDeliveries(session.ctx, selector),
  }
}

export async function getDelivery(
  deliveryId: string,
): Promise<
  { success: true; delivery: deliveriesCore.DeliveryDetail } | { success: false; error: string }
> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  const delivery = await deliveriesCore.getDelivery(session.ctx, deliveryId)
  if (!delivery) return { success: false, error: "Delivery not found" }
  return { success: true, delivery }
}

/** Queue a finished delivery to be sent again, keeping its delivery id. */
export async function redeliverDelivery(deliveryId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return deliveriesCore.redeliver(session.ctx, deliveryId)
}
