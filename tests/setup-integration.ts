/**
 * Integration test global setup.
 *
 * Runs once per worker before any integration test executes. Verifies the
 * test database is reachable, applies the Supabase-schema stubs the
 * migrations expect, applies pending migrations, and provides a between-
 * test cleanup that truncates application tables.
 *
 * We truncate-then-seed between tests rather than wrapping each test in a
 * transaction — the postgres-js driver doesn't play nicely with per-test
 * rollback. On vanilla Postgres truncation is fast (<10ms against a
 * near-empty DB) and gives a clean slate without connection-state issues.
 */

import { execSync } from 'node:child_process'
import { afterEach, beforeAll, vi } from 'vitest'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

// Next's `after()` schedules work to run after the response is flushed and
// requires a request scope. Server actions invoked directly from integration
// tests have no such scope, so the real `after()` throws. Stub it to a no-op:
// these tests assert on the persisted submission + answers, not on the deferred
// side-effects (event logging, Sheets/webhook/email delivery). In production
// `after()` runs within the request as normal.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: () => {} }
})

// Cache invalidation is request-scoped too: `updateTag` additionally requires a
// Server Action, and `revalidateTag`/`revalidatePath` require a request. Core
// mutations call them (deliberately — see src/lib/core/cache.ts), so they need
// stubbing here for the same reason `after()` does.
//
// These RECORD rather than no-op. Forgetting to invalidate is the failure this
// whole layer exists to prevent — an MCP write that skips it leaves the public
// form runtime serving a stale definition, with nothing throwing — so tests
// need to be able to assert it happened. See tests/helpers/cache-spy.ts.
vi.mock('next/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/cache')>()
  const spy = () => {
    const g = globalThis as typeof globalThis & {
      __mfCacheSpy?: { tags: string[]; paths: string[] }
    }
    g.__mfCacheSpy ??= { tags: [], paths: [] }
    return g.__mfCacheSpy
  }
  return {
    ...actual,
    updateTag: (tag: string) => void spy().tags.push(tag),
    revalidateTag: (tag: string) => void spy().tags.push(tag),
    revalidatePath: (path: string) => void spy().paths.push(path),
    // `cacheLife`/`cacheTag` only work when Next's compiler has processed a
    // `"use cache"` function, which does not happen under vitest — the real
    // `cacheLife` throws "only available with the cacheComponents config".
    // Data functions in src/lib/data/** are cached, so any test that reaches
    // one needs these to be inert. Caching itself is a production concern; what
    // the tests care about is the query underneath and the invalidation above.
    cacheLife: () => {},
    cacheTag: () => {},
  }
})

// ============================================================
// Supabase schema stubs.
//
// MakingFlow uses Supabase-managed schemas (auth, realtime, storage) for
// RLS, broadcasts, and file storage. Vanilla Postgres in the docker-compose
// test container has none of those, so migrations fail on the first
// reference. We create the minimum scaffolding the migrations expect:
//   - Schemas exist
//   - Functions like auth.uid() / realtime.topic() return NULL
//   - Tables (realtime.messages, storage.buckets, storage.objects) have the
//     columns the policies reference
//   - The `authenticated` / `anon` / `service_role` roles exist so
//     GRANT ... TO authenticated and CREATE POLICY ... TO authenticated work
//
// We do NOT replicate Supabase's real RLS behavior. Tests run as superuser
// and bypass RLS entirely. These stubs exist purely so DDL applies cleanly.
// ============================================================
const SUPABASE_STUBS = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS storage;

DO $do$ BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

GRANT USAGE ON SCHEMA auth, realtime, storage TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $fn$ SELECT NULL::uuid $fn$;

CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text
  LANGUAGE sql STABLE
  AS $fn$ SELECT NULL::text $fn$;

CREATE TABLE IF NOT EXISTS realtime.messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  topic text,
  extension text,
  event text,
  payload jsonb,
  inserted_at timestamptz DEFAULT now(),
  user_id uuid
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  path_tokens text[],
  version text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $fn$ SELECT string_to_array(name, '/') $fn$;
`

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('localhost')) {
    throw new Error(
      'Integration tests refuse to run unless DATABASE_URL points at localhost. ' +
        'Did you forget to source .env.test?',
    )
  }

  // Apply Supabase stubs first so the Drizzle migrations don't fail on
  // missing schemas/functions/tables.
  try {
    await db.execute(sql.raw(SUPABASE_STUBS))
  } catch (err) {
    throw new Error(
      `Failed to install Supabase stubs in test DB: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Apply application migrations. Idempotent — already-applied ones are skipped.
  //
  // Invoked through node rather than `pnpm db:migrate` for a mundane but
  // load-bearing reason: the pnpm wrapper alone costs ~13s on Windows (measured
  // — `pnpm exec true` takes that long), which on its own blew past this hook's
  // timeout and made every integration run fail in setup with no useful error.
  // Going straight to node takes the same work down to ~5s.
  try {
    execSync('node --import tsx scripts/migrate.mts', {
      stdio: 'inherit',
      env: { ...process.env },
    })
  } catch (err) {
    throw new Error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`)
  }
})

afterEach(async () => {
  // Let any fire-and-forget promises finish their DB writes before TRUNCATE
  // locks the tables — otherwise we hit deadlocks.
  await new Promise((r) => setTimeout(r, 25))

  // Truncate every public-schema table except drizzle's own migration
  // ledger. CASCADE handles FK chains.
  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'
  `)
  const tables = result.map((r) => r.tablename)
  if (tables.length === 0) return
  const truncateList = tables.map((t) => `"${t}"`).join(', ')
  await db.execute(sql.raw(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`))
})
