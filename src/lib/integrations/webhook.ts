import "server-only"

import type { WebhookDeliveryPayload } from "@/lib/db/schema"

/**
 * The HTTP transport for one webhook attempt. Nothing about retries, records or
 * scheduling lives here — see webhook-delivery.ts for that.
 */

/** Re-exported under its historical name; the shape lives in the schema now,
 *  because the delivery row stores it and this module imports FROM the schema. */
export type SubmissionPayload = WebhookDeliveryPayload
export type WebhookAnswer = WebhookDeliveryPayload["answers"][number]

export type PostResult = {
  ok: boolean
  status?: number
  error?: string
  /** The response body, for showing the user why their endpoint refused us. */
  body?: string
}

/** How long we wait for an endpoint before giving up on this attempt. */
const TIMEOUT_MS = 10_000

/** Response bytes read back. Enough to show an error, not enough to be a risk. */
const MAX_BODY_CHARS = 4000

/**
 * POST a body to a webhook URL with the given headers.
 *
 * REDIRECTS ARE NOT FOLLOWED, and this is load-bearing rather than tidiness.
 * The destination is validated against a private-range denylist before we get
 * here — and a 302 to `http://169.254.169.254` walks straight past that check,
 * because the redirect is followed by fetch, not by us. `redirect: "manual"`
 * turns that into a 3xx we count as a failure.
 *
 * Only 2xx counts as delivered. A 3xx is a misconfiguration, and every 4xx/5xx
 * is the endpoint telling us it did not take the delivery.
 */
export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<PostResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "manual",
    })

    // Best-effort: an endpoint that returns a status but no readable body is
    // still a perfectly good answer, so a failure here must not mask it.
    let text: string | undefined
    try {
      text = (await res.text()).slice(0, MAX_BODY_CHARS)
    } catch {
      text = undefined
    }

    const ok = res.status >= 200 && res.status < 300
    return {
      ok,
      status: res.status,
      body: text,
      error: ok ? undefined : `Endpoint returned ${res.status}`,
    }
  } catch (err) {
    const error = err as Error
    return {
      ok: false,
      error: error.name === "AbortError" ? `No response within ${TIMEOUT_MS / 1000}s` : error.message,
    }
  } finally {
    clearTimeout(timer)
  }
}
