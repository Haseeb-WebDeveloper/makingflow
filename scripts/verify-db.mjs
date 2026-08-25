// Verify a database matches the schema Drizzle expects. Read-only — safe to run
// against any environment.
//
//   node scripts/verify-db.mjs                 # uses DATABASE_URL from .env
//   node scripts/verify-db.mjs "postgres://…"  # or an explicit connection string
//
// Compares the live `public` schema against the latest drizzle snapshot
// (drizzle/meta/*_snapshot.json) and reports anything missing or extra. Useful
// after pointing the app at a new Supabase project: `npm run db:migrate` then
// this, to confirm the new database is a faithful copy.
//
import postgres from "postgres"
import fs from "node:fs"

const root = new URL("..", import.meta.url)

function databaseUrlFromEnv() {
  const envPath = new URL(".env", root)
  if (!fs.existsSync(envPath)) return null
  return fs
    .readFileSync(envPath, "utf8")
    .match(/^DATABASE_URL=(.*)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "")
}

/** Newest drizzle snapshot — the source of truth for what SHOULD exist. */
function latestSnapshot() {
  const journal = JSON.parse(
    fs.readFileSync(new URL("drizzle/meta/_journal.json", root), "utf8"),
  )
  const last = journal.entries.at(-1)
  const idx = String(last.idx).padStart(4, "0")
  return JSON.parse(
    fs.readFileSync(new URL(`drizzle/meta/${idx}_snapshot.json`, root), "utf8"),
  )
}

const DATABASE_URL = process.argv[2] || databaseUrlFromEnv()
if (!DATABASE_URL) {
  console.error("No DATABASE_URL — pass one as an argument or set it in .env")
  process.exit(1)
}

// Never print credentials; the host is enough to confirm which DB we hit.
const host = DATABASE_URL.replace(/^.*@/, "").replace(/\/.*$/, "")

const snapshot = latestSnapshot()
const expectedTables = Object.keys(snapshot.tables).map((t) => t.split(".").pop()).sort()
const expectedEnums = Object.keys(snapshot.enums).map((e) => e.split(".").pop()).sort()

const sql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15 })

const diff = (label, expected, actual) => {
  const missing = expected.filter((x) => !actual.includes(x))
  const extra = actual.filter((x) => !expected.includes(x))
  const ok = missing.length === 0 && extra.length === 0
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${label}: ${actual.length}/${expected.length}`)
  if (missing.length) console.log("  missing:", missing.join(", "))
  if (extra.length) console.log("  extra  :", extra.join(", "))
  return ok
}

try {
  console.log(`Verifying ${host}`)

  const [{ version }] = await sql`select version()`
  console.log(`  ${version.split(",")[0]}`)

  const tables = (
    await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`
  ).map((r) => r.tablename)

  const enums = (
    await sql`select distinct t.typname
              from pg_type t
              join pg_enum e on e.enumtypid = t.oid
              join pg_namespace n on n.oid = t.typnamespace
              where n.nspname = 'public'
              order by t.typname`
  ).map((r) => r.typname)

  // Drizzle's own bookkeeping table lives outside the snapshot.
  const applied = tables.includes("__drizzle_migrations")
    ? (await sql`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]))[0].n
    : null

  const tablesOk = diff("tables", expectedTables, tables.filter((t) => t !== "__drizzle_migrations"))
  const enumsOk = diff("enums", expectedEnums, enums)

  // Row counts: a fresh database should be empty everywhere.
  console.log("\nrow counts")
  let total = 0
  for (const t of expectedTables.filter((t) => tables.includes(t))) {
    const [{ n }] = await sql`select count(*)::int as n from ${sql(t)}`
    total += n
    if (n > 0) console.log(`  ${t.padEnd(24)} ${n}`)
  }
  console.log(total === 0 ? "  (all empty)" : `  total rows: ${total}`)

  if (applied !== null) console.log(`\ndrizzle migrations applied: ${applied}`)

  console.log(`\n${tablesOk && enumsOk ? "Schema matches the drizzle snapshot." : "Schema does NOT match — see above."}`)
  process.exit(tablesOk && enumsOk ? 0 : 1)
} catch (err) {
  console.error(`\nConnection/query failed: ${err.message}`)
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
