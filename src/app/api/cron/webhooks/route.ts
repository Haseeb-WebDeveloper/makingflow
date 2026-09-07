import { isCronRequest } from "@/lib/cron/auth"
import {
  claimDue,
  deliverBatch,
  pruneDeliveries,
  reclaimStale,
} from "@/lib/integrations/webhook-delivery"

/**
 * The webhook retry sweep.
 *
 * Invoked once a minute by a Postgres cron job — see doc/webhook-cron.md for
 * the SQL, which is a MANUAL step rather than a Drizzle migration because the
 * integration-test database is plain postgres:15-alpine and has neither pg_cron
 * nor pg_net.
 *
 * NO after() IN THIS ROUTE, deliberately. There is no user waiting, so there is
 * nothing to defer work for; the instance can be frozen the moment the response
 * is returned, which would silently drop deferred work; and the response body is
 * the ONLY diagnostic the caller records — pg_net is fire-and-forget, so an
 * empty 200 tells an operator nothing about whether the sweep did anything. It
 * also keeps the route testable, since after() is stubbed to a no-op in the
 * integration setup.
 */

// Bounded well below the caller's 55s pg_net timeout. Raising this REQUIRES
// raising STALE_CLAIM_MINUTES in webhook-delivery.ts first — if a run can
// outlive the reclaim window, a sweep still working has its rows taken and the
// delivery goes out twice at once.
export const maxDuration = 60

/** Retention runs on the hour rather than every minute. */
const PRUNE_MINUTE = 7

export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  // Before claiming: return anything stranded in `sending` by a worker that
  // died mid-flight. Without this those rows are owed forever and invisible to
  // the due-work query.
  const reclaimed = await reclaimStale()

  const due = await claimDue()
  const { sent, failed } = await deliverBatch(due)

  // Half of what bounds the copy of respondent answers in `payload` — see
  // design note 5 in the schema. Deterministic rather than sampled, so an
  // operator wondering why nothing was pruned can reason about it.
  const pruned = new Date().getUTCMinutes() === PRUNE_MINUTE ? await pruneDeliveries() : 0

  return Response.json({ reclaimed, claimed: due.length, sent, failed, pruned })
}
