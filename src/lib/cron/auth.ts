import "server-only"

import { timingSafeEqual } from "node:crypto"
import { bearerToken } from "@/lib/mcp/auth"

/**
 * Authentication for scheduled callbacks into the app.
 *
 * This is the first route in the codebase authenticated by a static shared
 * secret. Everything else is either a browser session or a bearer token looked
 * up in the database, neither of which a Postgres cron job has.
 *
 * TWO ACCEPTED VALUES, so rotating the secret has no outage. The value lives in
 * two places that cannot be updated atomically — the app's environment and the
 * Supabase Vault entry the job reads — so during a rotation one of them is
 * always briefly stale. Set the new value as CRON_SECRET with the old one in
 * CRON_SECRET_PREVIOUS, update the Vault entry, then drop CRON_SECRET_PREVIOUS.
 */

/**
 * Reads the secret lazily and complains specifically when it is missing,
 * following the `key()` pattern in src/lib/integrations/crypto.ts. There is no
 * env-schema module in this repo to register it with.
 */
function secrets(): string[] {
  const current = process.env.CRON_SECRET
  if (!current) {
    throw new Error(
      "CRON_SECRET is not set — the webhook retry sweep cannot authenticate callers.",
    )
  }
  const previous = process.env.CRON_SECRET_PREVIOUS
  return previous ? [current, previous] : [current]
}

/**
 * Constant-time comparison that tolerates a length mismatch.
 *
 * `timingSafeEqual` THROWS when the buffers differ in length, so the length
 * check has to come first — without it, a token of the wrong size is a 500
 * instead of a 401. The early return leaks only the length, which is not a
 * secret.
 */
function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Whether this request carries a currently-valid cron bearer token. */
export function isCronRequest(request: Request): boolean {
  const token = bearerToken(request)
  if (!token) return false
  // Every candidate is checked rather than short-circuiting, so acceptance time
  // does not reveal which of the two secrets matched.
  return secrets().reduce<boolean>((ok, secret) => matches(token, secret) || ok, false)
}
