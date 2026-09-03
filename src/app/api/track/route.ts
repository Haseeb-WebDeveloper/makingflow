import { trackPublicEvent } from "@/lib/analytics/track"
import { LIMITS, rateLimit } from "@/lib/rate-limit"

/**
 * Anonymous funnel beacon for the public runtime: records form `view` and
 * `start` events. Always returns 204 — it never blocks or leaks. `complete`
 * is recorded server-side in submitForm, not here.
 *
 * Rate limited because each call is an unauthenticated INSERT into an
 * append-only table that nothing prunes. Over the limit we silently drop the
 * beacon rather than 429 — it's fire-and-forget analytics, and the client
 * neither reads nor could act on the status.
 */
export async function POST(request: Request) {
  try {
    const limit = await rateLimit("track", LIMITS.track)
    if (!limit.ok) return new Response(null, { status: 204 })

    const { publicId, type } = await request.json()
    if (publicId && (type === "view" || type === "start")) {
      await trackPublicEvent(publicId, type)
    }
  } catch {
    /* best-effort */
  }
  return new Response(null, { status: 204 })
}
