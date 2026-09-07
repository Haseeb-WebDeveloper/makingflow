# Webhook retry sweep — Supabase Cron setup

The webhook delivery queue (`webhook_deliveries`) needs something to wake up
once a minute and retry what failed. That is a Postgres cron job calling
`POST /api/cron/webhooks`.

## Why this is not a Drizzle migration

Because it would break every integration test run.

`tests/setup-integration.ts` applies **every** migration through
`scripts/migrate.mts` to the container in `docker-compose.test.yml`, which is
`postgres:15-alpine` — plain Postgres, with neither `pg_cron` nor `pg_net`. A
migration containing `CREATE EXTENSION pg_cron` fails in `beforeAll` and takes
the whole integration suite down with a confusing error.

Two further reasons stack on top:

- The job body embeds the **app URL and the secret**, both of which differ per
  environment. A migration is a per-database artefact, not a per-environment
  one — running it against a preview branch would point that job at the wrong
  host.
- On Supabase, `cron.schedule` lives in the `postgres` database and needs a role
  the app's `DATABASE_URL` may not have.

So: run the SQL below **once per Supabase project**, in the SQL editor, as the
`postgres` role.

## Setup

```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- Secrets go in Vault, never inline in the job body. cron.job is an ordinary
-- table: `select command from cron.job` would hand the bearer token to anyone
-- with read access to the cron schema. Vault is not a hardware boundary —
-- vault.decrypted_secrets is still readable by postgres — but it keeps the
-- token out of casual queries, dumps and support sessions.
select vault.create_secret('https://your-app-host', 'app_base_url',
                           'Base URL for internal cron callbacks');
select vault.create_secret('<the CRON_SECRET value>', 'cron_secret',
                           'Bearer token for /api/cron/* routes');

select cron.schedule(
  'webhook-retry-sweep',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'app_base_url') || '/api/cron/webhooks',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);
```

`cron.schedule` **replaces** a job with the same name, so re-running that block
is idempotent. `vault.create_secret` is not — use
`vault.update_secret(<id>, '<new value>')` to change a value.

`timeout_milliseconds` sits just under the route's `maxDuration = 60` so a hung
route releases the pg_net worker before the next tick.

Set `CRON_SECRET` in the app environment to the same value as the Vault secret.

Optional, since job history is not pruned by default on every plan:

```sql
select cron.schedule('prune-cron-history', '0 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
```

## The thing to understand about pg_net

`net.http_post` returns a request id **immediately**. A background worker makes
the request out of band and writes the outcome to `net._http_response`.

**pg_cron therefore records the job as `succeeded` even when our route returns
401, 500, or is completely unreachable.** `cron.job_run_details` proves only
that the `select net.http_post(...)` statement ran — it is not a health signal
for the sweep. That is also why the sweep must be self-healing: a run that never
happened is indistinguishable from one that failed, and both are covered by the
next minute's tick plus the stale-claim reclaim.

## Verifying it

Four checks, in order. Each rules out a different failure.

```sql
-- 1. Registered and active?
select jobid, jobname, schedule, active
  from cron.job where jobname = 'webhook-retry-sweep';

-- 2. Did pg_cron fire the statement? (proves the schedule, NOT the HTTP call)
select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'webhook-retry-sweep')
 order by start_time desc limit 10;

-- 3. Did the request actually land, and with what status? THIS is the one that matters.
select id, status_code, error_msg, created, left(content, 300)
  from net._http_response order by created desc limit 10;

-- 4. Ground truth: is the queue draining?
select status, count(*), min(next_attempt_at)
  from webhook_deliveries group by 1;
```

Expected in (3): `status_code = 200` most minutes, with `content` being the
route's summary — `{"reclaimed":0,"claimed":0,"sent":0,"failed":0,"pruned":0}`.

Reading the failures:

| What you see | What it means |
| --- | --- |
| `401` | The app's `CRON_SECRET` and the Vault secret have diverged. |
| HTML body, or a redirect | `/api/cron` is missing from `shouldSkipEntirely` in `src/lib/supabase/middleware.ts`, so the proxy is sending the job to the login page. |
| `error_msg` set, no status | Wrong host in `app_base_url`, or the app is unreachable. |
| `401` on a preview URL | Vercel Deployment Protection. Register the job against production only — preview branches get no sweep, which is correct. |

## Rotating the secret

The app environment and the Vault entry cannot be updated atomically, so the
route accepts two values at once:

1. Set `CRON_SECRET` to the new value and `CRON_SECRET_PREVIOUS` to the old one.
2. Update the Vault secret to the new value.
3. Remove `CRON_SECRET_PREVIOUS`.

## Removing it

```sql
select cron.unschedule('webhook-retry-sweep');
```

Deliveries then accumulate as `pending` and stop being retried. Nothing is lost
— the rows are still there — but nothing is sent either, so the queue only
drains once the job comes back.
