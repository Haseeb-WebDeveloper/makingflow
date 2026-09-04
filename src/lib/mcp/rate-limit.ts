import "server-only"

/**
 * Per-key rate limiting for the MCP surface.
 *
 * `src/lib/rate-limit.ts` cannot be reused here, for two independent reasons
 * its own doc comment is explicit about:
 *
 *   1. It keys on the client IP. An MCP client is server-to-server traffic
 *      behind a shared egress address, so every workspace's automation would
 *      land in the same bucket — one busy tenant would throttle everyone else.
 *   2. Its counters live in process memory, so on serverless the effective
 *      limit is per-instance and resets on cold start. For the anonymous
 *      respondent path that is an acceptable floor beneath a firewall rule.
 *      For an authenticated, billable, AI-spending surface it is not.
 *
 * So this counts in Postgres, keyed by API key id, in a fixed window. One
 * upsert per request — the same `onConflictDoUpdate` shape `incrementAiCalls`
 * already uses — which is accurate across instances and needs no new
 * infrastructure. If request volume ever makes that round-trip matter, this is
 * the seam where Redis goes.
 *
 * Budgets are separated by cost, not by tool count: a read is cheap, a write
 * touches the database and invalidates caches, and an AI call spends real
 * money. A client looping on reads should not be able to exhaust the AI budget.
 */

import { sql } from "drizzle-orm"
import { db } from "@/lib/db"

export type Budget = "read" | "write" | "ai"

/** Requests per minute, per key. */
export const MCP_LIMITS: Record<Budget, number> = {
  // Generous: an agent exploring a workspace legitimately makes many small
  // reads in a burst, and throttling that just makes it look broken.
  read: 300,
  write: 120,
  // Deliberately tight — every one of these bills the workspace.
  ai: 20,
}

const WINDOW_MS = 60_000

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number }

/**
 * Count this request against the key's budget and say whether it may proceed.
 *
 * Fails OPEN on a database error. A counter that cannot be read is not a reason
 * to reject a legitimate tool call, and the budget exists to stop runaway
 * loops rather than to be a security boundary.
 */
export async function rateLimitApiKey(
  keyId: string,
  budget: Budget,
): Promise<RateLimitResult> {
  const limit = MCP_LIMITS[budget]
  const windowStart = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS)
  // ISO string, not the Date: a raw `sql` template binds parameters through
  // postgres-js directly, which rejects a Date with "the string argument must
  // be of type string". Because this function fails OPEN, that mistake did not
  // throw anywhere — it just quietly stopped rate limiting and logged.
  const windowStartIso = windowStart.toISOString()

  try {
    const [row] = await db.execute<{ hits: number }>(sql`
      insert into "mcp_rate_limits" ("key_id", "budget", "window_start", "hits")
      values (${keyId}, ${budget}, ${windowStartIso}::timestamptz, 1)
      on conflict ("key_id", "budget", "window_start")
        do update set "hits" = "mcp_rate_limits"."hits" + 1
      returning "hits"
    `)

    const hits = Number(row?.hits ?? 0)
    if (hits <= limit) return { ok: true, retryAfterSeconds: 0 }

    const elapsed = Date.now() - windowStart.getTime()
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)) }
  } catch (error) {
    console.error("[mcp] rate limit check failed; allowing the request", error)
    return { ok: true, retryAfterSeconds: 0 }
  }
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  )
}
