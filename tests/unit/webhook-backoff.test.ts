/**
 * The retry ladder, and the point at which we stop.
 *
 * Two failure modes are worth guarding, and both are quiet.
 *
 * A schedule that never returns null retries forever: a customer who deletes
 * their endpoint gets hammered indefinitely, and the queue never drains. A
 * schedule that returns null too early gives up while the receiver is still
 * coming back — which is the case retries exist for.
 *
 * The jitter matters more than it looks. Without it, two hundred deliveries
 * queued against one dead endpoint all come due in the same second and arrive
 * in lockstep on every sweep — hammering a service hardest exactly while it is
 * trying to recover.
 */

import { describe, expect, test } from "vitest"
import { MAX_ATTEMPTS, nextAttemptDelay } from "@/lib/integrations/webhook-delivery"

describe("the retry ladder", () => {
  test("gives up after the last rung, and not before", () => {
    // attempts = how many have been MADE. 1 is the inline attempt.
    for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts += 1) {
      expect(nextAttemptDelay(attempts)).not.toBeNull()
    }
    expect(nextAttemptDelay(MAX_ATTEMPTS)).toBeNull()
    expect(nextAttemptDelay(MAX_ATTEMPTS + 5)).toBeNull()
  })

  test("spans roughly eight hours, so a long outage is survivable", () => {
    let total = 0
    for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts += 1) {
      total += nextAttemptDelay(attempts) ?? 0
    }
    // Comfortably more than a deploy or a restart, comfortably less than a day.
    expect(total).toBeGreaterThan(6 * 3600)
    expect(total).toBeLessThan(10 * 3600)
  })

  test("backs off — each wait is longer than the one before", () => {
    // Compared with a margin because of the jitter: adjacent rungs differ by at
    // least 4x, so ±20% cannot reorder them.
    let previous = 0
    for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts += 1) {
      const delay = nextAttemptDelay(attempts) ?? 0
      expect(delay).toBeGreaterThan(previous)
      previous = delay
    }
  })

  test("jitters within ±20%, and actually varies", () => {
    const samples = Array.from({ length: 200 }, () => nextAttemptDelay(1) ?? 0)
    for (const delay of samples) {
      expect(delay).toBeGreaterThanOrEqual(Math.floor(30 * 0.8))
      expect(delay).toBeLessThanOrEqual(Math.ceil(30 * 1.2))
    }
    // A constant would pass the bounds check above while providing no spread at
    // all, which is the bug that matters here.
    expect(new Set(samples).size).toBeGreaterThan(1)
  })

  test("never schedules a retry in the past", () => {
    for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts += 1) {
      expect(nextAttemptDelay(attempts) ?? 1).toBeGreaterThan(0)
    }
  })

  test("treats a nonsensical attempt count as exhausted rather than crashing", () => {
    expect(nextAttemptDelay(0)).toBeNull()
    expect(nextAttemptDelay(-3)).toBeNull()
  })
})
