import "server-only"

import { createHmac } from "node:crypto"

/**
 * What we put on the wire, and how a receiver proves it came from us.
 *
 * TWO SIGNATURE HEADERS, DELIBERATELY, FOR NOW.
 *
 * The original `X-MakingFlow-Signature: sha256=<hex>` covers the body alone.
 * That signature never expires, so anyone who captures one delivery can replay
 * it at the receiver forever and the receiver has no way to tell. It also
 * carries no scheme version, so there is no way to change it later without
 * breaking every integration at once — which is the position this file exists
 * to get us out of.
 *
 * `X-MakingFlow-Signature-V2: t=<unix>,v1=<hex>` signs `${t}.${body}`, so a
 * receiver can reject anything older than a few minutes. The `v1` label is the
 * scheme version INSIDE the header (Stripe's convention), which is what makes a
 * future v2 a matter of adding a field rather than a flag day.
 *
 * Both are emitted during the transition. The old header's bytes are unchanged
 * — a test pins that — because changing it in place would break every receiver
 * verifying it today, and the failure would look like our bug rather than a
 * deliberate migration. Drop the legacy header once the docs' cutoff passes.
 *
 * THE DELIVERY ID IS NOT DECORATION. Retries mean a receiver can genuinely see
 * the same delivery twice — most often when they succeeded and our read timed
 * out. `X-MakingFlow-Delivery-Id` is stable across every attempt of a delivery,
 * including a manual redelivery, so deduplicating is possible at all.
 */

export const LEGACY_SIGNATURE_HEADER = "X-MakingFlow-Signature"
export const SIGNATURE_HEADER = "X-MakingFlow-Signature-V2"
export const DELIVERY_ID_HEADER = "X-MakingFlow-Delivery-Id"
export const EVENT_HEADER = "X-MakingFlow-Event"

/** Named so /docs/webhooks can publish it rather than retype it. */
export const USER_AGENT = "MakingFlow-Webhook/1.0"

/** The only event we emit today. Also published, so it is not a bare literal. */
export const SUBMISSION_CREATED_EVENT = "submission.created"

/** How far out of date a `t=` may be before a receiver should refuse it. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300

/** The original scheme: HMAC of the body, no timestamp. Frozen — see above. */
export function legacySignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

/** The current scheme: HMAC over `${timestamp}.${body}`. */
export function signature(secret: string, body: string, timestampSeconds: number): string {
  const signed = `${timestampSeconds}.${body}`
  return `t=${timestampSeconds},v1=${createHmac("sha256", secret).update(signed).digest("hex")}`
}

/**
 * Every header one attempt sends.
 *
 * One function rather than assembled at each call site, because there are two
 * senders — the inline attempt and the cron sweep — and a header set that
 * differs between the first attempt and the retries is the kind of bug that
 * only shows up at a customer's receiver.
 */
export function deliveryHeaders(args: {
  deliveryId: string
  event: string
  body: string
  /** Absent when the endpoint has no signing secret configured. */
  secret?: string | null
  /** Injectable so tests are not at the mercy of the clock. */
  timestampSeconds?: number
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    [DELIVERY_ID_HEADER]: args.deliveryId,
    [EVENT_HEADER]: args.event,
  }

  if (args.secret) {
    const t = args.timestampSeconds ?? Math.floor(Date.now() / 1000)
    headers[SIGNATURE_HEADER] = signature(args.secret, args.body, t)
    headers[LEGACY_SIGNATURE_HEADER] = legacySignature(args.secret, args.body)
  }

  return headers
}
