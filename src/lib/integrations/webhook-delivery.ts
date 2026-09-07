import "server-only"

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  webhookDeliveries,
  type WebhookDelivery,
  type WebhookIntegrationConfig,
} from "@/lib/db/schema"
import { checkOutboundUrl } from "@/lib/core/outbound-url"
import { postWebhook } from "@/lib/integrations/webhook"
import { deliveryHeaders } from "@/lib/integrations/webhook-signature"

/**
 * Getting an owed delivery onto the wire, and writing down what happened.
 *
 * NO AuthContext ANYWHERE IN THIS FILE, and that is structural rather than an
 * oversight. `unsafeSealContext` is restricted by eslint to three producer
 * modules, and an AuthContext requires a userId and a workspaceId — a sweep
 * that runs every minute across every tenant has neither. So the tenant-scoped,
 * ctx-gated surface (list, redeliver) lives in src/lib/core/webhooks.ts, and
 * everything that actually moves bytes lives here, callable from both the
 * request path and the cron route.
 *
 * CLAIMING IS THE WHOLE CONCURRENCY STORY. The first attempt runs inline in
 * after(), and a cron sweep runs every minute; a sweep can outlast its own
 * interval, so two of those can be in flight together. Rather than coordinating
 * them, every sender goes through the same `UPDATE ... FOR UPDATE SKIP LOCKED`,
 * which hands each caller a disjoint set. A row somebody else already took is
 * simply not returned, so "send it twice" is not a case that has to be handled
 * — it cannot arise.
 *
 * A worker that dies mid-flight leaves its rows stuck in `sending` forever;
 * `reclaimStale` is what makes that recoverable rather than a silent hole.
 */

/**
 * Waits between attempts. The first attempt is inline, so this schedule starts
 * at the FIRST retry: 30s, 2m, 10m, 1h, 6h — six attempts over roughly eight
 * hours.
 *
 * The old code retried once, ~50ms later. That helps with approximately none of
 * the real failure modes: a receiver restarting takes seconds, a deploy takes a
 * minute, and a read timeout means they were slow, not absent.
 */
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600] as const

/** Attempts including the inline one. Past this a delivery is `exhausted`. */
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1

/**
 * How long a claim may sit before a sweep assumes its worker died.
 *
 * MUST COMFORTABLY EXCEED the cron route's `maxDuration` (60s — see
 * src/app/api/cron/webhooks/route.ts). If it does not, a sweep that is still
 * legitimately working has its rows reclaimed out from under it and the
 * delivery genuinely goes out twice, at the same moment. The two constants live
 * in different files and nothing enforces the relationship, so if you raise
 * that timeout, raise this first.
 */
const STALE_CLAIM_MINUTES = 5

/** Rows per sweep. Bounded so one run always fits inside the route's budget. */
const CLAIM_BATCH = 20

/** Attempts in flight at once, so a batch of slow endpoints still finishes. */
const CONCURRENCY = 10

/** Response bodies are kept only to show the user; cap what we store. */
const MAX_STORED_BODY = 2000

/**
 * Seconds to wait before attempt number `attempts + 1`, or null when the
 * delivery has run out of attempts.
 *
 * Jittered ±20% so a receiver that just came back up is not hit by every queued
 * delivery in the same instant — the thundering herd is worst exactly when a
 * service is most fragile.
 */
export function nextAttemptDelay(attempts: number): number | null {
  const index = attempts - 1
  if (index < 0 || index >= BACKOFF_SECONDS.length) return null
  const base = BACKOFF_SECONDS[index]
  return Math.round(base * (1 + 0.2 * (Math.random() * 2 - 1)))
}

/**
 * A claimed delivery, with the endpoint's CURRENT signing secret and whether
 * that endpoint is still switched on.
 */
export type ClaimedDelivery = WebhookDelivery & {
  secret: string | null
  endpointEnabled: boolean
}

/**
 * Load claimed rows with their endpoint's secret.
 *
 * The secret is read now rather than snapshotted on the delivery row: storing
 * it would put a second copy of a credential in a second table, and reading it
 * live means rotating a secret takes effect on the next retry, which is what
 * someone rotating a leaked secret expects.
 */
async function withSecrets(ids: string[]): Promise<ClaimedDelivery[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      delivery: webhookDeliveries,
      config: formIntegrations.config,
      enabled: formIntegrations.enabled,
    })
    .from(webhookDeliveries)
    .innerJoin(formIntegrations, eq(formIntegrations.id, webhookDeliveries.integrationId))
    .where(inArray(webhookDeliveries.id, ids))

  return rows.map(({ delivery, config, enabled }) => ({
    ...delivery,
    secret: (config as WebhookIntegrationConfig).secret ?? null,
    endpointEnabled: enabled,
  }))
}

/**
 * Claim rows for sending, atomically.
 *
 * Returns ids from the UPDATE and re-reads them through Drizzle rather than
 * mapping the raw result: `RETURNING *` hands back snake_case columns that
 * would need hand-maintained mapping to stay in step with the schema. The rows
 * are already marked `sending`, so nothing can take them in between.
 */
async function claimIds(predicate: SQL, limit: number): Promise<string[]> {
  // WHAT ACTUALLY PREVENTS A DOUBLE SEND IS THE STATUS FLIP, not SKIP LOCKED.
  // The row locks last only as long as this one statement; an overlapping run's
  // subquery then fails to match because the row is no longer 'pending'.
  // SKIP LOCKED only stops the two runs from *blocking* each other while they
  // race, turning contention into disjoint batches instead of a queue.
  //
  // Do not "improve" this by wrapping the claim and the POST in one
  // transaction to hold the lock across the request. That pins a pooled
  // connection for the length of an outbound HTTP call, against a
  // transaction-mode pgbouncer with max: 5 — one slow customer endpoint would
  // exhaust the pool and take the app down.
  //
  // `now()` is the DATABASE clock throughout, so several serverless instances
  // with skewed clocks still agree on what is due.
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE webhook_deliveries
       SET status = 'sending',
           claimed_at = now(),
           claim_token = gen_random_uuid(),
           attempts = attempts + 1
     WHERE id IN (
       SELECT id
         FROM webhook_deliveries
        WHERE ${predicate}
        ORDER BY next_attempt_at
          FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING id
  `)
  return Array.from(claimed as Iterable<{ id: string }>).map((row) => row.id)
}

/** Claim whatever is due. Used by the cron sweep. */
export async function claimDue(limit: number = CLAIM_BATCH): Promise<ClaimedDelivery[]> {
  const ids = await claimIds(
    and(
      eq(webhookDeliveries.status, "pending"),
      sql`${webhookDeliveries.nextAttemptAt} <= now()`,
    )!,
    limit,
  )
  return withSecrets(ids)
}

/**
 * Claim specific rows. Used by the inline first attempt, which knows exactly
 * which deliveries it just created — and still goes through the claim, so a
 * sweep that got there first simply wins and the row is not sent twice.
 */
export async function claimByIds(ids: string[]): Promise<ClaimedDelivery[]> {
  if (ids.length === 0) return []
  // `inArray` rather than a hand-written `= ANY(${ids}::uuid[])`. Drizzle's sql
  // template SPREADS a JS array into one bind parameter per element, so the
  // hand-written form sends a bare uuid where Postgres expects an array literal
  // and every call throws 22P02. `inArray` emits the parameter list Drizzle
  // actually binds.
  //
  // Deliberately no `next_attempt_at <= now()` here. New deliveries are written
  // a few seconds in the future to keep the sweep away from them, and this is
  // the caller that is meant to act inside that window.
  const claimed = await claimIds(
    and(eq(webhookDeliveries.status, "pending"), inArray(webhookDeliveries.id, ids))!,
    ids.length,
  )
  return withSecrets(claimed)
}

/**
 * Return rows whose worker never came back to `pending`.
 *
 * Without this a crash between claiming and recording strands a delivery in
 * `sending` permanently — owed, never sent, and invisible to the due-work
 * query. Runs at the top of every sweep.
 */
export async function reclaimStale(): Promise<number> {
  const reclaimed = await db
    .update(webhookDeliveries)
    .set({ status: "pending" })
    .where(
      and(
        eq(webhookDeliveries.status, "sending"),
        sql`${webhookDeliveries.claimedAt} < now() - interval '${sql.raw(String(STALE_CLAIM_MINUTES))} minutes'`,
      ),
    )
    .returning({ id: webhookDeliveries.id })
  return reclaimed.length
}

/**
 * Every terminal write is fenced on the claim token.
 *
 * A worker that stalled past the reclaim window and then woke up would
 * otherwise write its own (stale) outcome over the row that now belongs to
 * somebody else. Fenced, its UPDATE matches zero rows and is silently dropped —
 * which is the correct outcome, because the run that holds the token is the one
 * whose result is current.
 */
function fenced(row: ClaimedDelivery) {
  return and(
    eq(webhookDeliveries.id, row.id),
    row.claimToken === null
      ? sql`${webhookDeliveries.claimToken} IS NULL`
      : eq(webhookDeliveries.claimToken, row.claimToken),
  )
}

async function recordSuccess(
  row: ClaimedDelivery,
  status: number,
  body: string | null,
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: "succeeded",
      deliveredAt: new Date(),
      lastStatus: status,
      lastError: null,
      lastResponseBody: body,
      claimedAt: null,
      claimToken: null,
    })
    .where(fenced(row))
}

async function recordFailure(
  row: ClaimedDelivery,
  outcome: { status?: number; error?: string; body?: string | null },
  { permanent = false }: { permanent?: boolean } = {},
): Promise<void> {
  // `row.attempts` was already incremented by the claim, so it is the number of
  // attempts MADE — which is exactly what the backoff schedule is indexed on.
  const delay = permanent ? null : nextAttemptDelay(row.attempts)

  await db
    .update(webhookDeliveries)
    .set({
      status: delay === null ? "exhausted" : "pending",
      nextAttemptAt: delay === null ? row.nextAttemptAt : new Date(Date.now() + delay * 1000),
      lastStatus: outcome.status ?? null,
      lastError: outcome.error ?? null,
      lastResponseBody: outcome.body ?? null,
      claimedAt: null,
      claimToken: null,
    })
    .where(fenced(row))
}

/**
 * Send one claimed delivery and record the outcome.
 *
 * The URL is re-validated HERE, on every attempt, not only when it was saved.
 * Rows stored before `checkOutboundUrl` existed are still live, and a hostname
 * that was public when it was saved can resolve somewhere else later. A URL
 * that fails the check is `exhausted` immediately rather than retried — no
 * amount of waiting makes an internal address a legitimate destination.
 */
export async function attemptDelivery(row: ClaimedDelivery): Promise<boolean> {
  // Switched off between enqueue and send. Turning a webhook off has to stop
  // deliveries that were already owed, or "pause" means "pause new ones and
  // keep firing the backlog for the next eight hours" — which is not what the
  // toggle says.
  if (!row.endpointEnabled) {
    await recordFailure(row, { error: "Endpoint disabled" }, { permanent: true })
    return false
  }

  const checked = checkOutboundUrl(row.url)
  if (!checked.ok) {
    await recordFailure(row, { error: checked.error }, { permanent: true })
    return false
  }

  const body = JSON.stringify(row.payload)
  const headers = deliveryHeaders({
    deliveryId: row.id,
    event: row.event,
    body,
    secret: row.secret,
  })

  const result = await postWebhook(checked.url, body, headers)
  const stored = result.body ? result.body.slice(0, MAX_STORED_BODY) : null

  if (result.ok && result.status !== undefined) {
    await recordSuccess(row, result.status, stored)
    return true
  }

  await recordFailure(row, { status: result.status, error: result.error, body: stored })
  return false
}

/** Send a batch, a few at a time so one slow endpoint cannot stall the rest. */
export async function deliverBatch(rows: ClaimedDelivery[]): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(
      rows.slice(i, i + CONCURRENCY).map((row) => attemptDelivery(row)),
    )
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) sent += 1
      else failed += 1
    }
  }

  return { sent, failed }
}

/**
 * Drop finished deliveries past their retention window.
 *
 * Not housekeeping — this is half of what bounds the copy of respondent answers
 * in `payload` (see design note 5 in the schema). Capped per run so retention
 * can never consume the sweep's budget and starve the actual deliveries.
 */
export async function pruneDeliveries(olderThanDays = 30, limit = 500): Promise<number> {
  const deleted = await db.execute<{ id: string }>(sql`
    DELETE FROM webhook_deliveries
     WHERE id IN (
       SELECT id
         FROM webhook_deliveries
        WHERE status IN ('succeeded', 'exhausted')
          AND created_at < now() - interval '${sql.raw(String(olderThanDays))} days'
        LIMIT ${limit}
     )
    RETURNING id
  `)
  return Array.from(deleted as Iterable<{ id: string }>).length
}

/** Recent deliveries for one endpoint, newest first. Untenanted — callers scope. */
export async function recentDeliveries(integrationId: string, limit = 20): Promise<WebhookDelivery[]> {
  return db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.integrationId, integrationId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
}
