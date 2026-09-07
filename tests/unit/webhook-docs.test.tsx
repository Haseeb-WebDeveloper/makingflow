/**
 * The public webhook documentation, checked against the server it describes.
 *
 * This page is read by developers who cannot see our code and have no way to
 * check what it claims. If it says the signature covers the body when it covers
 * `timestamp.body`, or promises a retry ladder we no longer run, they write
 * code that fails and the failure looks like our bug — from their side there is
 * nothing to debug against.
 *
 * So the numbers are derived from webhook-policy.ts rather than typed into the
 * prose, and these tests hold the two together: change the policy and the page
 * follows; change the page's shape and this fails loudly.
 */

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import WebhookDocsPage from "@/app/docs/webhooks/page"
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  RETENTION_DAYS,
  TIMEOUT_MS,
  TIMESTAMP_TOLERANCE_SECONDS,
} from "@/lib/integrations/webhook-policy"
import { SIGNATURE_HEADER, DELIVERY_ID_HEADER } from "@/lib/integrations/webhook-signature"

const html = renderToStaticMarkup(<WebhookDocsPage />)

/**
 * Tags stripped and entities decoded, so assertions can be written the way the
 * page reads. Without this, checking for `> 300` in a code sample fails against
 * the `&gt; 300` that actually renders — a test failure that says nothing about
 * the documentation being wrong.
 */
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;|&rsquo;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&gt;/g, ">")
  .replace(/&lt;/g, "<")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ")

describe("the webhook docs page", () => {
  test("renders", () => {
    expect(text).toContain("MakingFlow webhooks")
  })

  test("names the headers we actually send", () => {
    // A header renamed in code and not here sends every reader to verify
    // against something that never arrives.
    expect(html).toContain(SIGNATURE_HEADER)
    expect(html).toContain(DELIVERY_ID_HEADER)
  })

  test("says the signature covers the timestamp AND the body", () => {
    // The one fact nobody can guess, and the most common way to get this wrong.
    expect(html).toContain("${timestamp}.${body}")
    expect(text).toContain("Use the raw request body")
  })

  test("publishes the retry schedule the sender actually uses", () => {
    // One row for the immediate attempt, then one per backoff rung.
    expect(MAX_ATTEMPTS).toBe(BACKOFF_SECONDS.length + 1)
    expect(text).toContain("30 seconds later")
    expect(text).toContain("2 minutes later")
    expect(text).toContain("6 hours later")
    expect(text).toContain(`After attempt ${MAX_ATTEMPTS} we stop`)
  })

  test("publishes the timeout and replay window from the policy", () => {
    expect(text).toContain(`within ${TIMEOUT_MS / 1000} seconds`)
    expect(text).toContain(`than ${TIMESTAMP_TOLERANCE_SECONDS / 60} minutes old`)
    // And the copyable code enforces the same window the prose describes —
    // a sample that checks a different tolerance teaches the wrong thing to
    // everyone who pastes it.
    expect(text).toContain(`> ${TIMESTAMP_TOLERANCE_SECONDS}`)
  })

  test("publishes the retention window", () => {
    expect(text).toContain(`${RETENTION_DAYS} days`)
  })

  test("warns that delivery is at-least-once and unordered", () => {
    // Both are load-bearing for the reader's data model, not nice-to-knows: one
    // decides whether they deduplicate, the other whether they trust arrival
    // order for sequencing.
    expect(text).toContain("at least once")
    expect(text).toContain("Order is not guaranteed")
  })

  test("tells the reader answers are untrusted input", () => {
    expect(text).toContain("Treat every value as untrusted input")
  })

  test("marks the legacy signature as something not to build against", () => {
    expect(text).toContain("Do not build against it")
  })

  test("carries no real secret or live token", () => {
    // It is a public page and the examples are hand-written, but a copied-in
    // real value would be published to the internet.
    expect(html).not.toMatch(/mf_sk_live_[A-Za-z0-9]/)
    expect(html).not.toMatch(/whsec_[A-Za-z0-9]{8}/)
  })
})
