/**
 * The cron route's front door.
 *
 * This is the first endpoint in the app authenticated by a static shared
 * secret, so the usual protections (a session, a database lookup) are not there
 * to catch a mistake.
 *
 * The specific trap: `timingSafeEqual` THROWS on buffers of unequal length. A
 * length guard that is missing turns "wrong token" into an unhandled exception —
 * a 500 rather than a 401 — and a 500 from an auth check is the kind of thing
 * that gets a route quietly marked "flaky" instead of "unauthorized".
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { isCronRequest } from "@/lib/cron/auth"

const SECRET = "cron_secret_value"

function request(authorization?: string): Request {
  return new Request("http://localhost:3000/api/cron/webhooks", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET)
  vi.stubEnv("CRON_SECRET_PREVIOUS", "")
})

afterEach(() => vi.unstubAllEnvs())

describe("cron authentication", () => {
  test("accepts the configured secret", () => {
    expect(isCronRequest(request(`Bearer ${SECRET}`))).toBe(true)
  })

  test("rejects a missing header", () => {
    expect(isCronRequest(request())).toBe(false)
  })

  test("rejects a wrong secret of the same length", () => {
    const wrong = "x".repeat(SECRET.length)
    expect(wrong).toHaveLength(SECRET.length)
    expect(isCronRequest(request(`Bearer ${wrong}`))).toBe(false)
  })

  test("rejects a token of a different length without throwing", () => {
    // The timingSafeEqual trap. Both directions, because a guard written as
    // `candidate.length > expected.length` passes one and throws on the other.
    expect(() => isCronRequest(request("Bearer short"))).not.toThrow()
    expect(isCronRequest(request("Bearer short"))).toBe(false)
    expect(isCronRequest(request(`Bearer ${SECRET}${SECRET}`))).toBe(false)
  })

  test("rejects a correct prefix that carries extra characters", () => {
    expect(isCronRequest(request(`Bearer ${SECRET}extra`))).toBe(false)
  })

  test("rejects a non-bearer scheme", () => {
    expect(isCronRequest(request(`Basic ${SECRET}`))).toBe(false)
  })

  test("accepts the previous secret during a rotation", () => {
    // The app's env and the Vault entry the job reads cannot be updated
    // atomically, so one of them is always briefly stale. Without this the
    // sweep silently 401s for the length of the rotation.
    vi.stubEnv("CRON_SECRET", "new_secret_value")
    vi.stubEnv("CRON_SECRET_PREVIOUS", SECRET)
    expect(isCronRequest(request("Bearer new_secret_value"))).toBe(true)
    expect(isCronRequest(request(`Bearer ${SECRET}`))).toBe(true)
    expect(isCronRequest(request("Bearer neither_of_them"))).toBe(false)
  })

  test("says specifically what is wrong when the secret is unset", () => {
    // A generic 401 here would send someone hunting through Supabase for a
    // misconfigured job when the app is simply missing an env var.
    vi.stubEnv("CRON_SECRET", "")
    expect(() => isCronRequest(request("Bearer anything"))).toThrow(/CRON_SECRET/)
  })
})
