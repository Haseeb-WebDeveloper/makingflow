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
import { afterEach, beforeAll } from 'vitest'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

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

  // Apply application migrations. Idempotent — drizzle skips already-applied.
  try {
    execSync('pnpm db:migrate', { stdio: 'inherit', env: { ...process.env } })
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
