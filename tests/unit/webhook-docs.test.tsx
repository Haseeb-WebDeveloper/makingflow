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
 *
 * WHY THIS NO LONGER RENDERS THE PAGE. The page is now an MDX document served
 * through an async route, and vitest has no MDX toolchain — adding one would
 * mean testing a different compiler than the Turbopack build actually uses,
 * which is worse than not testing it. So the contract is split in two: the
 * components that carry the derived values are rendered here, and the prose is
 * checked as source text in `docs-content.test.ts`. Between them they
 * assert strictly more than the single render did, because the prose test can
 * also catch a number typed in by hand.
 */

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  WebhookHeadersTable,
  WebhookPayloadSample,
  WebhookReceiver,
  WebhookRetryTable,
} from "@/components/docs/live/webhooks"
import { DOC_VALUES } from "@/lib/docs/values"
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  RETENTION_DAYS,
  TIMEOUT_MS,
  TIMESTAMP_TOLERANCE_SECONDS,
} from "@/lib/integrations/webhook-policy"
import {
  DELIVERY_ID_HEADER,
  SIGNATURE_HEADER,
  USER_AGENT,
} from "@/lib/integrations/webhook-signature"

function decode(html: string): string {
  return html
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
}

/**
 * Prose and tables: tags become spaces, so words either side of a cell boundary
 * do not run together.
 *
 * Entities are decoded because checking for `> 300` in a sample would otherwise
 * fail against the `&gt; 300` that actually renders — a test failure that says
 * nothing about the documentation being wrong.
 */
function readable(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ")
}

/**
 * Code samples: tags are removed WITHOUT a space, which is not a detail.
 *
 * Shiki wraps every token in its own `<span>`, and the whitespace between
 * tokens lives inside those spans as text. Substituting a space for each tag —
 * as the prose helper does — inserts one in the middle of every identifier, so
 * `express.raw` reads as `express. raw` and the assertion that the sample uses
 * the raw body fails while the sample is perfectly correct.
 */
function codeText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ""))
}

const retries = renderToStaticMarkup(<WebhookRetryTable />)
const headers = renderToStaticMarkup(<WebhookHeadersTable />)
const node = renderToStaticMarkup(<WebhookReceiver runtime="node" />)
const python = renderToStaticMarkup(<WebhookReceiver runtime="python" />)
const payload = renderToStaticMarkup(<WebhookPayloadSample />)

describe("the retry schedule we publish", () => {
  test("has one row per attempt the sender actually makes", () => {
    expect(MAX_ATTEMPTS).toBe(BACKOFF_SECONDS.length + 1)
    // One <tr> per attempt, plus the header row.
    expect(retries.match(/<tr/g)).toHaveLength(MAX_ATTEMPTS + 1)
  })

  test("names each wait in the reader's units", () => {
    const text = readable(retries)
    expect(text).toContain("30 seconds later")
    expect(text).toContain("2 minutes later")
    expect(text).toContain("6 hours later")
  })
})

describe("the headers we document", () => {
  test("are the ones the sender sets", () => {
    // Renamed in code and not here, and every reader verifies against a header
    // that never arrives. These used to be retyped as literals.
    expect(headers).toContain(SIGNATURE_HEADER)
    expect(headers).toContain(DELIVERY_ID_HEADER)
    expect(headers).toContain(USER_AGENT)
  })
})

describe("the copyable receivers", () => {
  test("sign the timestamp AND the body", () => {
    // The one fact nobody can guess, and the most common way to get this wrong.
    expect(codeText(node)).toContain("${timestamp}.${raw}")
  })

  test("enforce the same replay window the server does", () => {
    // A sample that checks a different tolerance teaches the wrong thing to
    // everyone who pastes it, and they cannot tell it is wrong.
    expect(codeText(node)).toContain(`> ${TIMESTAMP_TOLERANCE_SECONDS}`)
    expect(codeText(python)).toContain(`> ${TIMESTAMP_TOLERANCE_SECONDS}`)
  })

  test("cite the timeout from the policy", () => {
    expect(codeText(node)).toContain(`${TIMEOUT_MS / 1000} seconds`)
  })

  test("read the raw body rather than the parsed one", () => {
    expect(codeText(node)).toContain("express.raw")
    expect(codeText(python)).toContain("request.get_data()")
  })

  test("deduplicate on the delivery id", () => {
    expect(node).toContain(DELIVERY_ID_HEADER)
    expect(python).toContain(DELIVERY_ID_HEADER)
  })
})

describe("the values quoted in prose", () => {
  test("are derived from the policy, in the units the prose uses", () => {
    expect(DOC_VALUES["webhook.timeoutSeconds"]).toBe(String(TIMEOUT_MS / 1000))
    expect(DOC_VALUES["webhook.replayWindowMinutes"]).toBe(
      String(TIMESTAMP_TOLERANCE_SECONDS / 60),
    )
    expect(DOC_VALUES["webhook.retentionDays"]).toBe(String(RETENTION_DAYS))
    expect(DOC_VALUES["webhook.maxAttempts"]).toBe(String(MAX_ATTEMPTS))
  })

  test("never claim we retry for longer than we do", () => {
    // The old page said "about 8 hours" in hand-written prose. The real ladder
    // totals 7.2, so it was already overstating how long a failing endpoint has
    // to come back — which is exactly what someone sizing an alert relies on.
    const totalHours = BACKOFF_SECONDS.reduce((sum, s) => sum + s, 0) / 3600
    const claimed = Number(DOC_VALUES["webhook.retryWindow"].match(/\d+/)?.[0])
    expect(claimed).toBeLessThanOrEqual(totalHours)
  })
})

describe("nothing published here is a live secret", () => {
  test("no API key or signing secret appears in any sample", () => {
    for (const html of [retries, headers, node, python, payload]) {
      expect(html).not.toMatch(/mf_sk_live_[A-Za-z0-9]/)
      expect(html).not.toMatch(/whsec_[A-Za-z0-9]{8}/)
    }
  })
})
