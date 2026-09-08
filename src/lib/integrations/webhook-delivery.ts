import "server-only"

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  integrationDeliveries,
  type DiscordIntegrationConfig,
  type EmailIntegrationConfig,
  type IntegrationConfig,
  type IntegrationDelivery,
  type WebhookIntegrationConfig,
} from "@/lib/db/schema"
import { checkOutboundUrl } from "@/lib/core/outbound-url"
import { postWebhook } from "@/lib/integrations/webhook"
import { deliveryHeaders } from "@/lib/integrations/webhook-signature"
import { deliverDiscord } from "@/lib/integrations/discord"
import { sendSubmissionEmail } from "@/lib/integrations/email"
import {
  loadDeliveryContent,
  type SendOutcome,
} from "@/lib/integrations/submission-content"
import { BACKOFF_SECONDS, JITTER_RATIO } from "@/lib/integrations/webhook-policy"

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

// The schedule lives in webhook-policy.ts because /docs/webhooks publishes it.
// The old code retried once, ~50ms later, which helps with approximately none
// of the real failure modes: a receiver restarting takes seconds, a deploy
// takes a minute, and a read timeout means they were slow, not absent.
export { MAX_ATTEMPTS } from "@/lib/integrations/webhook-policy"

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
  return Math.round(base * (1 + JITTER_RATIO * (Math.random() * 2 - 1)))
}

/**
 * A claimed delivery, with the endpoint's CURRENT signing secret and whether
 * that endpoint is still switched on.
 */
export type ClaimedDelivery = IntegrationDelivery & {
  /**
   * The destination's CURRENT configuration, read at claim time rather than
   * snapshotted onto the delivery.
   *
   * Snapshotting would put a second copy of a credential in a second table —
   * a webhook signing secret, a Discord webhook URL, which IS the credential.
   * Reading it live also means rotating a secret takes effect on the next
   * retry, which is what someone rotating a leaked one expects.
   *
   * Null for a Sheets or Notion delivery whose per-form row has not been
   * provisioned yet; those senders resolve their destination themselves.
   */
  config: IntegrationConfig | null
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
  // LEFT join, not inner. Sheets and Notion are driven by a workspace
  // connection and their per-form row is provisioned lazily, so a delivery can
  // legitimately have no integration row yet. An inner join drops exactly those
  // rows — and since the claim has already flipped them to `sending` and
  // incremented attempts, they would sit stuck until the stale reclaim, be
  // claimed again, and loop forever without ever being sent.
  const rows = await db
    .select({
      delivery: integrationDeliveries,
      config: formIntegrations.config,
      enabled: formIntegrations.enabled,
    })
    .from(integrationDeliveries)
    .leftJoin(formIntegrations, eq(formIntegrations.id, integrationDeliveries.integrationId))
    .where(inArray(integrationDeliveries.id, ids))

  return rows.map(({ delivery, config, enabled }) => ({
    ...delivery,
    config: (config as IntegrationConfig | null) ?? null,
    // No integration row means nothing has been switched off — Sheets and
    // Notion decide that from the workspace connection at send time.
    endpointEnabled: enabled ?? true,
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
      eq(integrationDeliveries.status, "pending"),
      sql`${integrationDeliveries.nextAttemptAt} <= now()`,
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
    and(eq(integrationDeliveries.status, "pending"), inArray(integrationDeliveries.id, ids))!,
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
    .update(integrationDeliveries)
    .set({ status: "pending" })
    .where(
      and(
        eq(integrationDeliveries.status, "sending"),
        sql`${integrationDeliveries.claimedAt} < now() - interval '${sql.raw(String(STALE_CLAIM_MINUTES))} minutes'`,
      ),
    )
    .returning({ id: integrationDeliveries.id })
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
    eq(integrationDeliveries.id, row.id),
    row.claimToken === null
      ? sql`${integrationDeliveries.claimToken} IS NULL`
      : eq(integrationDeliveries.claimToken, row.claimToken),
  )
}

async function recordSuccess(
  row: ClaimedDelivery,
  status: number,
  body: string | null,
): Promise<void> {
  await db
    .update(integrationDeliveries)
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
    .update(integrationDeliveries)
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
 * Post a webhook.
 *
 * The URL is re-validated HERE, on every attempt, not only when it was saved.
 * Rows stored before `checkOutboundUrl` existed are still live, and a hostname
 * that was public when it was saved can resolve somewhere else later. A URL
 * that fails the check is retired immediately rather than retried — no amount
 * of waiting makes an internal address a legitimate destination.
 */
async function sendWebhook(row: ClaimedDelivery): Promise<SendOutcome> {
  // url and payload are nullable now the table carries every type, and only a
  // webhook has them. A webhook row missing them is corrupt, not retryable.
  if (!row.url || !row.payload) {
    return { ok: false, error: "Webhook delivery has no destination", permanent: true }
  }

  const checked = checkOutboundUrl(row.url)
  if (!checked.ok) return { ok: false, error: checked.error, permanent: true }

  const body = JSON.stringify(row.payload)
  const result = await postWebhook(
    checked.url,
    body,
    deliveryHeaders({
      deliveryId: row.id,
      event: row.event,
      body,
      secret: (row.config as WebhookIntegrationConfig | null)?.secret ?? null,
    }),
  )
  return { ok: result.ok, status: result.status, error: result.error, body: result.body }
}

/**
 * Send one claimed delivery and record what happened.
 *
 * Dispatches on type. Every sender returns a SendOutcome rather than throwing
 * or logging, so the recording is in one place and cannot be forgotten by
 * whoever adds the next integration — the switch below will not compile
 * without them.
 */
export async function attemptDelivery(row: ClaimedDelivery): Promise<boolean> {
  // Switched off between enqueue and send. Turning an integration off has to
  // stop deliveries that were already owed, or "pause" means "pause new ones
  // and keep firing the backlog for the next several hours" — which is not what
  // the toggle says.
  if (!row.endpointEnabled) {
    await recordFailure(row, { error: "Integration disabled" }, { permanent: true })
    return false
  }

  let outcome: SendOutcome

  if (row.type === "webhook") {
    outcome = await sendWebhook(row)
  } else {
    // Everything else renders the submission at send time rather than replaying
    // a snapshot, so the content is loaded here once for whichever sender runs.
    const content = await loadDeliveryContent(row.submissionId)
    if (!content) {
      // The submission was deleted. There is nothing left to deliver and no
      // retry will bring it back.
      outcome = { ok: false, error: "Submission no longer exists", permanent: true }
    } else {
      switch (row.type) {
        case "email":
          outcome = await sendSubmissionEmail(
            (row.config ?? { recipients: [] }) as EmailIntegrationConfig,
            content,
            row.id,
          )
          break
        case "discord":
          outcome = await deliverDiscord(
            (row.config ?? { webhookUrl: "" }) as DiscordIntegrationConfig,
            content,
          )
          break
        default:
          // Sheets and Notion are enqueued but not yet driven from here; they
          // still run inline. Retired rather than retried so a row cannot loop.
          outcome = {
            ok: false,
            error: `No queue sender for ${row.type} yet`,
            permanent: true,
          }
      }
    }
  }

  const stored = outcome.body ? outcome.body.slice(0, MAX_STORED_BODY) : null

  if (outcome.ok) {
    await recordSuccess(row, outcome.status ?? 200, stored)
    return true
  }

  await recordFailure(
    row,
    { status: outcome.status, error: outcome.error, body: stored },
    { permanent: outcome.permanent },
  )
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
export async function recentDeliveries(integrationId: string, limit = 20): Promise<IntegrationDelivery[]> {
  return db
    .select()
    .from(integrationDeliveries)
    .where(eq(integrationDeliveries.integrationId, integrationId))
    .orderBy(desc(integrationDeliveries.createdAt))
    .limit(limit)
}
