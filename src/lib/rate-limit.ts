import "server-only"
import { headers } from "next/headers"

/**
 * Fixed-window rate limiting for the PUBLIC, unauthenticated surface: the
 * respondent runtime's endpoints and the submit action. None of them had any
 * limit, which left `/api/partial` accepting unbounded writes and
 * `/api/forms/turn` acting as an open meter on our AI spend.
 *
 * SCOPE — read this before relying on it. The counters live in this process's
 * memory, so on a serverless deployment the effective limit is *per instance*:
 * traffic fanned across N instances gets up to N× the nominal budget, and a
 * cold start resets the window. That is enough to stop a runaway client loop, a
 * stuck retry, or casual scripted abuse — it is NOT a defence against a
 * distributed attacker. The real perimeter is a Vercel Firewall rule on these
 * same paths; this module is the in-repo floor beneath it.
 *
 * Callers that cannot identify the client (no request scope, no forwarded IP)
 * are ALLOWED through rather than blocked: failing closed here would reject
 * genuine submissions whenever a header is missing, and a lost submission is
 * worse than an unmetered one.
 */

/**
 * Per-IP budgets, per minute.
 *
 * SIZED FOR NAT, NOT FOR ONE PERSON. An IP is not a respondent: an office, a
 * conference hall, a school and a mobile carrier all present hundreds of people
 * behind a single address — and events, RSVPs and team intake are core use
 * cases, so that is normal traffic, not an attack. A load test at 40 concurrent
 * respondents on one IP proved the point: the first cut of these numbers turned
 * 30 of 40 real submissions into "Too many attempts".
 *
 * So these are deliberately generous. They exist to stop ONE broken client
 * looping — a stuck retry, a runaway script — which fires orders of magnitude
 * above any of these. They are not, and cannot be, the anti-spam control; that
 * is the Firewall rule, plus `one_response_per_person` on forms that want it.
 * When in doubt, raise them: a blocked respondent is a lost submission and the
 * form owner never learns it happened.
 */
export const LIMITS = {
  /** Final submit. User-visible harm if wrongly blocked, so the most generous. */
  submit: 300,
  /** Draft autosave — fires roughly once per typing pause, per respondent. */
  partial: 600,
  /** Draft resume — once per page load. */
  partialResume: 600,
  /** Funnel beacons. Cheap, and dropped silently when over. */
  track: 600,
  /** Conversational turn. Costs a model call, so tighter than the rest — but a
   *  throttled respondent degrades to the classic form rather than being stuck. */
  turn: 300,
} as const

type Bucket = { count: number; resetAt: number }

// One map per process, parked on globalThis so a dev HMR recompile doesn't
// silently reset every window (same reasoning as the pg client in db/index.ts).
const globalForRateLimit = globalThis as unknown as { _mfRateLimit?: Map<string, Bucket> }
const buckets: Map<string, Bucket> = globalForRateLimit._mfRateLimit ?? new Map()
globalForRateLimit._mfRateLimit = buckets

/** Above this many tracked keys we sweep expired entries before adding more, so
 *  a long-lived instance can't grow the map without bound. */
const SWEEP_THRESHOLD = 10_000

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * The requesting client's IP, from the proxy headers Vercel/Cloudflare set.
 * `null` when there's no request scope (e.g. a server action invoked directly
 * from a test) or no forwarded address.
 */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers()
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null
  } catch {
    return null
  }
}

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number }

/**
 * Consume one unit from `name`'s window for this client. `limit` requests are
 * allowed per `windowMs`; the window starts at the first request and resets
 * wholesale (not a sliding window — cheap, and precise enough for a floor).
 */
export async function rateLimit(
  name: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const ip = await clientIp()
  if (!ip) return { ok: true, retryAfterSeconds: 0 } // unidentifiable — let it through

  const now = Date.now()
  const key = `${name}:${ip}`
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= SWEEP_THRESHOLD) sweep(now)
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSeconds: 0 }
  }

  existing.count++
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  return { ok: true, retryAfterSeconds: 0 }
}

/** Standard 429 for the public route handlers. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  )
}
