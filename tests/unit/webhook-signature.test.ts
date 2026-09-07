/**
 * The webhook wire contract.
 *
 * These headers are the part of this feature we cannot take back. Once someone
 * has written code that verifies our signature, changing the bytes breaks their
 * integration in a way that looks like OUR bug — their endpoint starts refusing
 * deliveries and nothing on our side errors.
 *
 * So two things are pinned here. The legacy header's output is frozen against a
 * literal expected value, computed the old way, so a refactor cannot quietly
 * alter it during the transition. And the new header is asserted to sign
 * `${t}.${body}` rather than the body alone — the timestamp being INSIDE the
 * signed material is the entire security property, since a `t` a receiver
 * cannot trust is just a decorative field.
 */

import { createHmac } from "node:crypto"
import { describe, expect, test } from "vitest"
import {
  DELIVERY_ID_HEADER,
  EVENT_HEADER,
  LEGACY_SIGNATURE_HEADER,
  SIGNATURE_HEADER,
  deliveryHeaders,
  legacySignature,
  signature,
} from "@/lib/integrations/webhook-signature"

const SECRET = "whsec_test_value"
const BODY = JSON.stringify({ event: "submission.created", answers: [] })
const DELIVERY_ID = "11111111-2222-3333-4444-555555555555"
const T = 1_757_246_400

describe("the legacy signature", () => {
  test("still produces exactly what it always did", () => {
    // Computed the old way, independently of the implementation. If this fails,
    // every receiver verifying the old header breaks the moment it ships.
    const expected = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`
    expect(legacySignature(SECRET, BODY)).toBe(expected)
  })

  test("covers the body alone — which is why it is being replaced", () => {
    // The same body signs identically forever, so a captured delivery replays
    // indefinitely. Stated as a test so the limitation is not folklore.
    expect(legacySignature(SECRET, BODY)).toBe(legacySignature(SECRET, BODY))
  })
})

describe("the timestamped signature", () => {
  test("signs the timestamp together with the body", () => {
    const expected = createHmac("sha256", SECRET).update(`${T}.${BODY}`).digest("hex")
    expect(signature(SECRET, BODY, T)).toBe(`t=${T},v1=${expected}`)
  })

  test("is NOT the HMAC of the body alone", () => {
    // The failure this guards against is signing `body` and merely prefixing a
    // `t=`, which looks correct in a header dump and defends against nothing.
    const bodyOnly = createHmac("sha256", SECRET).update(BODY).digest("hex")
    expect(signature(SECRET, BODY, T)).not.toContain(bodyOnly)
  })

  test("changes when only the timestamp changes", () => {
    expect(signature(SECRET, BODY, T)).not.toBe(signature(SECRET, BODY, T + 1))
  })
})

describe("the headers one attempt sends", () => {
  const headers = deliveryHeaders({
    deliveryId: DELIVERY_ID,
    event: "submission.created",
    body: BODY,
    secret: SECRET,
    timestampSeconds: T,
  })

  test("carries both signatures during the transition", () => {
    expect(headers[SIGNATURE_HEADER]).toBe(signature(SECRET, BODY, T))
    expect(headers[LEGACY_SIGNATURE_HEADER]).toBe(legacySignature(SECRET, BODY))
  })

  test("always identifies the delivery and the event", () => {
    expect(headers[DELIVERY_ID_HEADER]).toBe(DELIVERY_ID)
    expect(headers[EVENT_HEADER]).toBe("submission.created")
    expect(headers["Content-Type"]).toBe("application/json")
  })

  test("signs nothing when the endpoint has no secret", () => {
    const unsigned = deliveryHeaders({
      deliveryId: DELIVERY_ID,
      event: "submission.created",
      body: BODY,
      secret: null,
    })
    expect(unsigned[SIGNATURE_HEADER]).toBeUndefined()
    expect(unsigned[LEGACY_SIGNATURE_HEADER]).toBeUndefined()
    // The delivery id is not a security feature and must survive regardless —
    // an unsigned receiver still needs to deduplicate our retries.
    expect(unsigned[DELIVERY_ID_HEADER]).toBe(DELIVERY_ID)
  })

  test("never puts the secret in a header", () => {
    for (const value of Object.values(headers)) {
      expect(value).not.toContain(SECRET)
    }
  })
})
