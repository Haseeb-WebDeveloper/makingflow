/**
 * End-to-end load test for the respondent path.
 *
 * Drives the REAL HTTP stack — page render, /api/track, /api/partial, and the
 * submit Server Action — against a running `next start`, then checks the
 * invariants that matter for a launch directly in the database:
 *
 *   - every accepted submission is stored exactly once
 *   - a completed response leaves NO leftover `partial` twin (the drop-off
 *     poisoning regression)
 *   - abandoned sessions leave exactly one partial each
 *   - no submission carries duplicate answers for a field
 *   - a capped form never exceeds its cap, however concurrent the traffic
 *
 * SAFETY: refuses to run unless DATABASE_URL points at localhost. This seeds
 * and deletes rows; it must never touch a real database.
 *
 * Usage:
 *   pnpm test:db:up
 *   npx next build
 *   # terminal 1 — serve against the throwaway DB:
 *   DATABASE_URL=postgres://makingflow_test:makingflow_test@localhost:54322/makingflow_test \
 *     npx next start -p 3100
 *   # terminal 2:
 *   npx tsx scripts/loadtest.mts --base http://localhost:3100 --sessions 300 --vus 50
 *
 * Flags:
 *   --base <url>       server under test           (default http://localhost:3100)
 *   --sessions <n>     respondent sessions to run  (default 200)
 *   --vus <n>          concurrent sessions         (default 40)
 *   --abandon <0..1>   fraction that never submit  (default 0.2)
 *   --scenario <name>  all | throughput | cap | read | nat   (default all)
 *   --keep             leave seeded data behind for inspection
 */
import { config as loadEnv } from "dotenv"
import { and, eq, sql } from "drizzle-orm"

// The db module builds its connection pool from DATABASE_URL at IMPORT time,
// and ES imports are hoisted above every statement — so a static import here
// would connect before this line ran, using whatever DATABASE_URL the ambient
// shell had (or none). Load the env first, then pull the db in dynamically.
loadEnv({ path: ".env.test", quiet: true })

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const has = (name: string) => argv.includes(`--${name}`)

const BASE = flag("base", "http://localhost:3100").replace(/\/$/, "")
const SESSIONS = Number(flag("sessions", "200"))
const VUS = Number(flag("vus", "40"))
const ABANDON = Number(flag("abandon", "0.2"))
const SCENARIO = flag("scenario", "all")
const KEEP = has("keep")

if (!process.env.DATABASE_URL?.includes("localhost")) {
  console.error(
    "REFUSING TO RUN: DATABASE_URL must point at localhost.\n" +
      "This script seeds and deletes rows. Start the throwaway DB with `pnpm test:db:up`.",
  )
  process.exit(1)
}

// Safe to connect now that the env is loaded.
const { db } = await import("@/lib/db")
const { workspaces, forms, formFields, submissions, answers, formEvents } = await import(
  "@/lib/db/schema"
)

// ── tiny helpers ────────────────────────────────────────────────────────────
const pad = (s: string | number, n: number) => String(s).padStart(n)
const pct = (sorted: number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

/** Each virtual user gets its own address, as real respondents would. The
 *  rate limiter keys on this, so sharing one would just measure throttling. */
const ipFor = (i: number) => `203.0.${Math.floor(i / 254) % 254}.${(i % 254) + 1}`

type Timing = { label: string; ms: number[]; errors: number; statuses: Map<number, number> }
const timings = new Map<string, Timing>()
function record(label: string, ms: number, status: number, ok: boolean) {
  let t = timings.get(label)
  if (!t) timings.set(label, (t = { label, ms: [], errors: 0, statuses: new Map() }))
  t.ms.push(ms)
  if (!ok) t.errors++
  t.statuses.set(status, (t.statuses.get(status) ?? 0) + 1)
}

async function timed(label: string, fn: () => Promise<Response>) {
  const t0 = performance.now()
  try {
    const res = await fn()
    const body = await res.text()
    record(label, performance.now() - t0, res.status, res.ok)
    return { status: res.status, body, ok: res.ok }
  } catch (err) {
    record(label, performance.now() - t0, 0, false)
    return { status: 0, body: String(err), ok: false }
  }
}

/** Run `total` tasks with at most `concurrency` in flight. */
async function pool<T>(total: number, concurrency: number, task: (i: number) => Promise<T>) {
  const results: T[] = new Array(total)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      for (;;) {
        const i = next++
        if (i >= total) return
        results[i] = await task(i)
      }
    }),
  )
  return results
}

// ── seeding ─────────────────────────────────────────────────────────────────
const RUN = `lt${Date.now().toString(36)}`

async function seedForm(opts: { title: string; submissionLimit?: number }) {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `Loadtest ${RUN}`, slug: `loadtest-${RUN}-${Math.random().toString(36).slice(2, 8)}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: opts.title,
      publicId: `${RUN}${Math.random().toString(36).slice(2, 8)}`,
      status: "published",
      renderMode: "classic",
      submissionLimit: opts.submissionLimit ?? null,
    })
    .returning({ id: forms.id, publicId: forms.publicId })

  // A realistically shaped form: required text, an email, a choice WITH an Other
  // box (the path that was rejecting submissions), and a long free-text answer.
  const fieldRows = await db
    .insert(formFields)
    .values([
      { formId: form.id, type: "short_text" as const, label: "Your name", required: true, position: 0 },
      { formId: form.id, type: "email" as const, label: "Email", required: true, position: 1 },
      {
        formId: form.id,
        type: "multiple_choice" as const,
        label: "How did you hear about us?",
        position: 2,
        options: [
          { id: "o1", label: "Search" },
          { id: "o2", label: "A friend" },
        ],
        config: { allowOther: true },
      },
      { formId: form.id, type: "long_text" as const, label: "Anything else?", position: 3 },
    ])
    .returning({ id: formFields.id, position: formFields.position })

  const byPos = new Map(fieldRows.map((f) => [f.position, f.id]))
  return {
    workspaceId: ws.id,
    formId: form.id,
    publicId: form.publicId,
    name: byPos.get(0)!,
    email: byPos.get(1)!,
    source: byPos.get(2)!,
    notes: byPos.get(3)!,
  }
}
type Seeded = Awaited<ReturnType<typeof seedForm>>

function answersFor(f: Seeded, i: number) {
  return [
    { fieldId: f.name, value: `Respondent ${i}` },
    { fieldId: f.email, value: `respondent${i}@example.test` },
    // Every third respondent uses the Other box — free text that is deliberately
    // not one of the listed options.
    { fieldId: f.source, value: i % 3 === 0 ? `Podcast episode ${i}` : "Search" },
    { fieldId: f.notes, value: `Notes from session ${i}. `.repeat(8) },
  ]
}

// ── submit action discovery ─────────────────────────────────────────────────
/**
 * Server Actions are addressed by a build-specific id, not a URL. Read the
 * candidates out of the build manifest and probe them, so this keeps working
 * across rebuilds instead of hard-coding an id that silently rots.
 */
async function discoverSubmitAction(probe: Seeded): Promise<string> {
  // Read rather than import: this is a build artifact that doesn't exist until
  // `next build` has run, so a static import wouldn't typecheck on a clean tree.
  const { readFile } = await import("node:fs/promises")
  const raw = await readFile(new URL("../.next/server/server-reference-manifest.json", import.meta.url), "utf8").catch(
    () => {
      throw new Error("No build manifest found — run `npx next build` first.")
    },
  )
  const manifest = JSON.parse(raw) as { node: Record<string, { workers?: Record<string, unknown> }> }

  const candidates = Object.entries(manifest.node)
    .filter(([, v]) => Object.keys(v.workers ?? {}).includes("app/f/[publicId]/page"))
    .map(([id]) => id)

  for (const id of candidates) {
    const res = await fetch(`${BASE}/f/${probe.publicId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "next-action": id,
        "x-forwarded-for": "198.51.100.7",
      },
      body: JSON.stringify([{ publicId: probe.publicId, answers: answersFor(probe, -1) }]),
    })
    const body = await res.text()
    if (res.ok && /"success"\s*:\s*true/.test(body)) return id
  }
  throw new Error(
    `Could not identify submitForm among ${candidates.length} action ids. ` +
      `Is the server running the CURRENT build at ${BASE}?`,
  )
}

// ── one respondent session ──────────────────────────────────────────────────
async function session(f: Seeded, i: number, actionId: string, opts: { abandon: boolean; ip?: string }) {
  const ip = opts.ip ?? ipFor(i)
  const h = { "content-type": "application/json", "x-forwarded-for": ip }
  const all = answersFor(f, i)

  await timed("GET /f/[publicId]", () => fetch(`${BASE}/f/${f.publicId}`, { headers: { "x-forwarded-for": ip } }))
  await timed("POST /api/track", () =>
    fetch(`${BASE}/api/track`, { method: "POST", headers: h, body: JSON.stringify({ publicId: f.publicId, type: "view" }) }),
  )
  await timed("POST /api/track", () =>
    fetch(`${BASE}/api/track`, { method: "POST", headers: h, body: JSON.stringify({ publicId: f.publicId, type: "start" }) }),
  )

  // Autosave as the respondent types: one save per field, each replacing the
  // draft — the hottest write path in the app.
  let draftId: string | null = null
  for (let n = 1; n <= all.length; n++) {
    const r = await timed("POST /api/partial", () =>
      fetch(`${BASE}/api/partial`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ publicId: f.publicId, submissionId: draftId, answers: all.slice(0, n) }),
      }),
    )
    try {
      draftId = JSON.parse(r.body)?.submissionId ?? draftId
    } catch {
      /* throttled or refused — keep the id we have */
    }
  }

  if (opts.abandon) return { abandoned: true, submitted: false, draftId }

  const r = await timed("SUBMIT (server action)", () =>
    fetch(`${BASE}/f/${f.publicId}`, {
      method: "POST",
      headers: { ...h, "next-action": actionId },
      body: JSON.stringify([{ publicId: f.publicId, answers: all, submissionId: draftId }]),
    }),
  )
  const success = /"success"\s*:\s*true/.test(r.body)

  // The unload flush that used to mint a duplicate `partial` twin of a finished
  // response. The client now suppresses it; the server refuses it either way.
  // Firing it here is the point of the test.
  if (success && draftId) {
    await timed("POST /api/partial (post-submit flush)", () =>
      fetch(`${BASE}/api/partial`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ publicId: f.publicId, submissionId: draftId, answers: all }),
      }),
    )
  }
  return { abandoned: false, submitted: success, draftId }
}

// ── reporting ───────────────────────────────────────────────────────────────
function reportTimings() {
  console.log("\n  request                              n     p50     p95     p99     max   non-2xx")
  console.log("  " + "─".repeat(84))
  for (const t of timings.values()) {
    const s = [...t.ms].sort((a, b) => a - b)
    const codes = [...t.statuses.entries()].filter(([c]) => c < 200 || c >= 300)
    console.log(
      `  ${t.label.padEnd(36)}${pad(t.ms.length, 4)}  ${pad(pct(s, 50).toFixed(0) + "ms", 6)}  ` +
        `${pad(pct(s, 95).toFixed(0) + "ms", 6)}  ${pad(pct(s, 99).toFixed(0) + "ms", 6)}  ` +
        `${pad(Math.max(...s).toFixed(0) + "ms", 6)}   ${codes.length ? codes.map(([c, n]) => `${c}×${n}`).join(" ") : "—"}`,
    )
  }
}

const checks: { ok: boolean; label: string; detail: string }[] = []
function check(ok: boolean, label: string, detail = "") {
  checks.push({ ok, label, detail })
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
}

async function counts(formId: string) {
  const [row] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${submissions.status} = 'completed')::int`,
      partial: sql<number>`count(*) filter (where ${submissions.status} = 'partial')::int`,
    })
    .from(submissions)
    .where(eq(submissions.formId, formId))
  return row
}

/** Any submission holding two answer rows for the same field. */
async function duplicateAnswers(formId: string) {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT a.submission_id, a.field_id
      FROM ${answers} a JOIN ${submissions} s ON s.id = a.submission_id
      WHERE s.form_id = ${formId} AND a.field_id IS NOT NULL
      GROUP BY 1, 2 HAVING count(*) > 1
    ) d`)
  return Number(rows[0]?.n ?? 0)
}

// ── scenarios ───────────────────────────────────────────────────────────────
async function scenarioThroughput(actionId: string) {
  console.log(`\n▸ THROUGHPUT — ${SESSIONS} sessions, ${VUS} concurrent, ${Math.round(ABANDON * 100)}% abandon\n`)
  const f = await seedForm({ title: `Loadtest throughput ${RUN}` })

  const t0 = performance.now()
  const results = await pool(SESSIONS, VUS, (i) =>
    session(f, i, actionId, { abandon: i % Math.max(2, Math.round(1 / ABANDON)) === 0 && ABANDON > 0 }),
  )
  const elapsed = (performance.now() - t0) / 1000

  const submitted = results.filter((r) => r.submitted).length
  const abandoned = results.filter((r) => r.abandoned).length
  const c = await counts(f.formId)

  reportTimings()
  console.log(
    `\n  ${SESSIONS} sessions in ${elapsed.toFixed(1)}s  ·  ${(SESSIONS / elapsed).toFixed(1)} sessions/s  ` +
      `·  ${(submitted / elapsed).toFixed(1)} submissions/s\n`,
  )

  check(c.completed === submitted, "every accepted submission is stored exactly once", `${c.completed} rows / ${submitted} accepted`)
  check(
    c.partial === abandoned,
    "no orphan partials — abandoned sessions only",
    `${c.partial} partial rows / ${abandoned} abandoned sessions`,
  )
  check((await duplicateAnswers(f.formId)) === 0, "no submission has duplicate answers for a field")

  const [ev] = await db
    .select({ n: sql<number>`count(*) filter (where ${formEvents.type} = 'complete')::int` })
    .from(formEvents)
    .where(eq(formEvents.formId, f.formId))
  check(ev.n === submitted, "one funnel 'complete' event per submission", `${ev.n} events / ${submitted} submissions`)

  // The Other box: free text that is not one of the listed options must survive.
  const [other] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.formId, f.formId),
        eq(submissions.status, "completed"),
        eq(answers.fieldId, f.source),
        sql`${answers.value} #>> '{}' LIKE 'Podcast episode%'`,
      ),
    )
  check(other.n > 0, "Other free-text answers were accepted and stored", `${other.n} stored`)
  return f
}

async function scenarioCap(actionId: string) {
  const CAP = 25
  const attempts = Math.max(60, VUS * 2)
  console.log(`\n▸ CAP — submissionLimit=${CAP}, ${attempts} simultaneous attempts\n`)
  const f = await seedForm({ title: `Loadtest cap ${RUN}`, submissionLimit: CAP })

  const results = await pool(attempts, attempts, (i) => session(f, i, actionId, { abandon: false }))
  const accepted = results.filter((r) => r.submitted).length
  const c = await counts(f.formId)

  check(c.completed <= CAP, `the cap is never exceeded`, `${c.completed} completed, cap ${CAP}`)
  check(c.completed === CAP, `the cap is actually reached`, `${c.completed} of ${CAP}`)
  check(accepted === c.completed, "accepted responses match stored rows", `${accepted} accepted / ${c.completed} stored`)
  return f
}

async function scenarioRead() {
  console.log(`\n▸ READ — ${SESSIONS * 2} concurrent public form renders\n`)
  const f = await seedForm({ title: `Loadtest read ${RUN}` })
  timings.clear()
  const t0 = performance.now()
  await pool(SESSIONS * 2, VUS * 2, (i) =>
    timed("GET /f/[publicId]", () =>
      fetch(`${BASE}/f/${f.publicId}`, { headers: { "x-forwarded-for": ipFor(i) } }),
    ),
  )
  const elapsed = (performance.now() - t0) / 1000
  reportTimings()
  console.log(`\n  ${((SESSIONS * 2) / elapsed).toFixed(0)} page renders/s\n`)
  const t = timings.get("GET /f/[publicId]")!
  check(t.errors === 0, "every public form render succeeded", `${t.errors} failures`)
  return f
}

async function scenarioNat(actionId: string) {
  // A conference hall or an office all egress from one address. This is normal
  // traffic for RSVP/intake forms, so it must not look like an attack.
  const n = Number(flag("nat", "150"))
  console.log(`\n▸ NAT — ${n} respondents sharing ONE IP (office wifi / conference)\n`)
  const f = await seedForm({ title: `Loadtest nat ${RUN}` })
  timings.clear()
  const results = await pool(n, n, (i) => session(f, i, actionId, { abandon: false, ip: "198.51.100.42" }))
  const accepted = results.filter((r) => r.submitted).length
  reportTimings()
  const throttled = [...timings.values()].reduce((s, t) => s + (t.statuses.get(429) ?? 0), 0)
  console.log(
    `\n  ${accepted}/${n} submissions accepted from a single IP; ${throttled} requests were rate limited.\n`,
  )
  check(
    accepted === n,
    "respondents behind one shared IP are not blocked",
    `${accepted}/${n} got through — if this fails, raise the submit rate limit`,
  )
  return f
}

// ── main ────────────────────────────────────────────────────────────────────
const seeded: Seeded[] = []
try {
  console.log(`\nMakingFlow load test → ${BASE}`)
  console.log(`DB: ${process.env.DATABASE_URL!.replace(/:[^:@]+@/, ":***@")}`)

  const probe = await seedForm({ title: `Loadtest probe ${RUN}` })
  seeded.push(probe)
  const actionId = await discoverSubmitAction(probe)
  console.log(`submit action: ${actionId}`)

  if (SCENARIO === "all" || SCENARIO === "throughput") {
    timings.clear()
    seeded.push(await scenarioThroughput(actionId))
  }
  if (SCENARIO === "all" || SCENARIO === "cap") {
    timings.clear()
    seeded.push(await scenarioCap(actionId))
  }
  if (SCENARIO === "all" || SCENARIO === "read") seeded.push(await scenarioRead())
  if (SCENARIO === "all" || SCENARIO === "nat") seeded.push(await scenarioNat(actionId))

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${"═".repeat(86)}`)
  console.log(failed.length === 0 ? `ALL ${checks.length} CHECKS PASSED` : `${failed.length} of ${checks.length} CHECKS FAILED`)
  for (const f of failed) console.log(`  FAIL  ${f.label} — ${f.detail}`)
  console.log("═".repeat(86) + "\n")

  if (!KEEP) {
    for (const s of seeded) await db.delete(workspaces).where(eq(workspaces.id, s.workspaceId))
    console.log("seeded data removed (pass --keep to inspect it)\n")
  } else {
    console.log(`seeded workspaces kept: ${seeded.map((s) => s.workspaceId).join(", ")}\n`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
} catch (err) {
  console.error("\nload test failed to run:", err)
  if (!KEEP) {
    for (const s of seeded) await db.delete(workspaces).where(eq(workspaces.id, s.workspaceId)).catch(() => {})
  }
  process.exit(1)
}
