import { trackPublicEvent } from "@/lib/analytics/track"

/**
 * Anonymous funnel beacon for the public runtime: records form `view` and
 * `start` events. Always returns 204 — it never blocks or leaks. `complete`
 * is recorded server-side in submitForm, not here.
 */
export async function POST(request: Request) {
  try {
    const { publicId, type } = await request.json()
    if (publicId && (type === "view" || type === "start")) {
      await trackPublicEvent(publicId, type)
    }
  } catch {
    /* best-effort */
  }
  return new Response(null, { status: 204 })
}
