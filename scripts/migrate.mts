/**
 * Apply Drizzle migrations, one transaction per migration file.
 *
 * WHY THIS EXISTS INSTEAD OF `drizzle-kit migrate`
 *
 * drizzle-kit wraps EVERY pending migration in a SINGLE transaction. That is
 * fine until an enum is involved: Postgres refuses to USE a value added by
 * `ALTER TYPE ... ADD VALUE` until the transaction that added it has committed
 * (SQLSTATE 55P04, "unsafe use of new value").
 *
 * This repo hits that exactly. `integration_type` is created in 0000 with
 * ('google_sheets', 'webhook', 'email'); 'discord' is appended in 0002 and
 * 'notion' in 0003; then 0009 uses 'notion' in a DELETE and in a partial unique
 * index. On a database that has already committed 0003, a later run of 0009
 * works — which is why this was invisible during development, where migrations
 * were applied a few at a time as they were written. On a database that applies
 * 0003 and 0009 together, the whole batch aborts. That is every FRESH install:
 * a new production database, and every ephemeral test container.
 *
 * There is no fix available inside the SQL. Casting the column to text dodges
 * 55P04 in the DELETE, but an enum-to-text cast is only STABLE, so the same
 * trick in the index predicate fails with "functions in index predicate must be
 * marked IMMUTABLE". The transaction boundary is the real problem, so that is
 * what this changes.
 *
 * COMPATIBILITY — this is deliberately a drop-in for drizzle-kit migrate, not a
 * reinvention. Same `drizzle.__drizzle_migrations` table, same sha256-of-file
 * hash, and the same "apply everything newer than the latest recorded
 * created_at" rule (see the pg dialect's migrate() in drizzle-orm). A database
 * previously migrated by drizzle-kit carries straight on; nothing re-runs.
 *
 * THE TRADE-OFF, STATED PLAINLY: a failure part-way through a batch leaves the
 * database partially migrated rather than rolled back to the start. Each
 * individual migration is still atomic. This is how most migration tools behave
 * and it is the price of being able to add an enum value and use it later.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import "dotenv/config"
import postgres from "postgres"

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean }
type Journal = { version: string; dialect: string; entries: JournalEntry[] }

const MIGRATIONS_DIR = join(process.cwd(), "drizzle")
const SCHEMA = "drizzle"
const TABLE = "__drizzle_migrations"

function loadMigrations() {
  const journal: Journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  )
  return journal.entries
    .slice()
    .sort((a, b) => a.when - b.when)
    .map((entry) => {
      const file = join(MIGRATIONS_DIR, `${entry.tag}.sql`)
      const query = readFileSync(file, "utf8")
      return {
        tag: entry.tag,
        folderMillis: entry.when,
        // Must match drizzle's own hash: sha256 over the RAW file contents.
        hash: createHash("sha256").update(query).digest("hex"),
        statements: query.split("--> statement-breakpoint"),
      }
    })
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")

  // Say which database this is about to change, before changing it. `.env` is
  // loaded as a fallback (dotenv does not override an already-set variable), so
  // running this with no environment set targets whatever `.env` points at —
  // which may well be production. Printing the host makes that impossible to
  // do by accident. The credentials are never printed.
  const target = new URL(url)
  console.log(`migrating: ${target.hostname}${target.pathname}`)

  // max: 1 so every statement lands on the same backend — a migration that
  // creates something and then uses it must not race across pooled sockets.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })

  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`)
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${SCHEMA}"."${TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)

    const [last] = await sql.unsafe<{ created_at: string | null }[]>(
      `select created_at from "${SCHEMA}"."${TABLE}" order by created_at desc limit 1`,
    )
    const lastApplied = last?.created_at != null ? Number(last.created_at) : null

    const pending = loadMigrations().filter(
      (m) => lastApplied === null || lastApplied < m.folderMillis,
    )

    if (pending.length === 0) {
      console.log("migrations: up to date")
      return
    }

    for (const migration of pending) {
      // One transaction PER MIGRATION — the whole point of this script.
      await sql.begin(async (tx) => {
        for (const statement of migration.statements) {
          if (statement.trim().length === 0) continue
          await tx.unsafe(statement)
        }
        await tx.unsafe(
          `insert into "${SCHEMA}"."${TABLE}" ("hash", "created_at") values ($1, $2)`,
          [migration.hash, migration.folderMillis],
        )
      })
      console.log(`applied ${migration.tag}`)
    }

    console.log(`migrations: ${pending.length} applied`)
  } finally {
    await sql.end()
  }
}

main().catch((error: unknown) => {
  // Surface the ACTUAL Postgres error. drizzle-kit swallows it and prints only
  // the failing query, which is what made this class of bug so slow to find.
  const err = error as { message?: string; code?: string; detail?: string; hint?: string }
  console.error("\nMigration failed.")
  console.error(`  ${err.message ?? String(error)}`)
  if (err.code) console.error(`  code: ${err.code}`)
  if (err.detail) console.error(`  detail: ${err.detail}`)
  if (err.hint) console.error(`  hint: ${err.hint}`)
  process.exit(1)
})
