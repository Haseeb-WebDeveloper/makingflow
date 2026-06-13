// Seed the first workspace with a realistic demo company: forms, submissions
// (with device/country/source metadata), answers, and funnel events spread over
// the last 30 days. Idempotent — re-running clears prior demo data (forms are
// tagged with settings._seed = true) and regenerates.
//
//   node scripts/seed-demo.mjs
//
import postgres from "postgres"
import fs from "node:fs"
import crypto from "node:crypto"

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
const DATABASE_URL = env
  .match(/^DATABASE_URL=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "")

// max:1 → all queries pipeline over a single connection (avoids EMAXCONN on the pooler).
const sql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 20 })

// ── helpers ──────────────────────────────────────────────────────────
const rnd = (n) => Math.floor(Math.random() * n)
const pick = (a) => a[rnd(a.length)]
const uuid = () => crypto.randomUUID()
const hex = (n) => crypto.randomBytes(n).toString("hex")
const weighted = (pairs) => {
  const tot = pairs.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * tot
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v
  return pairs[0][0]
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── distributions ────────────────────────────────────────────────────
const DEVICES = [["desktop", 55], ["mobile", 38], ["tablet", 7]]
const COUNTRIES = [
  ["US", 26], ["GB", 11], ["IN", 12], ["PK", 7], ["DE", 7], ["CA", 6], ["AU", 5],
  ["FR", 4], ["BR", 4], ["NG", 3], ["AE", 3], ["ES", 3], ["NL", 2], ["SG", 2], ["JP", 2], ["ZA", 2],
]
const SOURCES = [
  [{}, 30], // Direct
  [{ referrer: "https://www.google.com/" }, 18],
  [{ referrer: "https://www.bing.com/" }, 5],
  [{ referrer: "https://t.co/abc123" }, 7],
  [{ referrer: "https://www.facebook.com/" }, 6],
  [{ referrer: "https://www.linkedin.com/feed/" }, 5],
  [{ referrer: "https://www.instagram.com/" }, 4],
  [{ referrer: "https://news.ycombinator.com/" }, 3],
  [{ urlParams: { utm_source: "newsletter", utm_medium: "email" } }, 6],
  [{ urlParams: { utm_source: "google", utm_medium: "cpc" } }, 5],
  [{ urlParams: { utm_source: "meta", utm_medium: "paid_social" } }, 4],
]

const NAMES = [
  "Sarah Kim", "Daniel Porter", "Maya Singh", "Alex Boyd", "Rayna Rosser",
  "Liam Chen", "Emily Thompson", "Michael Carter", "Sophia Morgan", "John Davis",
  "Aisha Khan", "Marco Rossi", "Lena Müller", "Diego Alvarez", "Nina Petrova",
  "Tom Becker", "Priya Nair", "Omar Haddad", "Grace Lee", "Noah Wright",
]
const DOMAINS = ["gmail.com", "outlook.com", "proton.me", "company.co", "acme.io", "hey.com"]
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, ".")

const FORM_DEFS = [
  { title: "Customer Feedback Survey", status: "published", pop: 5, rate: 0.74, extra: { type: "rating", label: "How satisfied are you?" } },
  { title: "Product Waitlist", status: "published", pop: 7, rate: 0.82, extra: { type: "short_text", label: "What are you most excited about?" } },
  { title: "Event Registration — Summit 2026", status: "published", pop: 4, rate: 0.63, extra: { type: "multiple_choice", label: "Which track?", options: ["Design", "Engineering", "Growth", "Leadership"] } },
  { title: "Job Application — Product Designer", status: "published", pop: 2, rate: 0.41, extra: { type: "url", label: "Portfolio link" } },
  { title: "NPS — Q2", status: "published", pop: 3, rate: 0.69, extra: { type: "nps", label: "How likely are you to recommend us?" } },
  { title: "Bug Report", status: "published", pop: 2, rate: 0.55, extra: { type: "long_text", label: "Describe the issue" } },
  { title: "Newsletter Signup", status: "published", pop: 6, rate: 0.88, extra: null },
  { title: "Contact Us", status: "published", pop: 3, rate: 0.6, extra: { type: "long_text", label: "Your message" } },
  { title: "Beta Access Request", status: "draft", pop: 0, rate: 0.5, extra: { type: "short_text", label: "Company" } },
  { title: "2025 Holiday Survey", status: "closed", pop: 1, rate: 0.7, extra: { type: "yes_no", label: "Did you enjoy it?" } },
]

function extraValue(extra) {
  switch (extra.type) {
    case "rating": return weighted([[5, 30], [4, 35], [3, 20], [2, 10], [1, 5]])
    case "nps": return weighted([[10, 18], [9, 20], [8, 18], [7, 12], [6, 8], [5, 6], [4, 4], [3, 4], [2, 3], [1, 3], [0, 4]])
    case "multiple_choice": return pick(extra.options)
    case "yes_no": return Math.random() < 0.72 ? "Yes" : "No"
    case "url": return pick(["https://dribbble.com/jane", "https://www.behance.net/jane", "https://jane.design"])
    case "short_text": return pick(["Acme Inc", "Globex", "Initech", "Umbrella", "Soylent", "Hooli"])
    case "long_text": return pick(["Loved the experience!", "Could be a bit faster.", "Great support team.", "Found a small bug on mobile.", "Keep it up!", "Pricing is unclear."])
    default: return "N/A"
  }
}

// ── main ─────────────────────────────────────────────────────────────
const [ws] = await sql`select id from workspaces order by created_at asc limit 1`
if (!ws) {
  console.error("No workspace found — sign up / create a workspace first.")
  await sql.end()
  process.exit(1)
}
const [member] = await sql`select user_id from workspace_members where workspace_id = ${ws.id} limit 1`
const userId = member?.user_id ?? null

console.log("Seeding workspace:", ws.id)
const cleared = await sql`delete from forms where workspace_id = ${ws.id} and settings->>'_seed' = 'true'`
console.log("Cleared previous demo forms:", cleared.count)

const DAYS = 30
const DAY_MS = 86400000
const now = Date.now()
const todayUTC = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())

const formRows = []
const fieldRows = []
const subRows = []
const answerRows = []
const eventRows = []

for (const def of FORM_DEFS) {
  const formId = uuid()
  const createdAt = new Date(now - (DAYS + 4) * DAY_MS)
  const publishedAt = def.status === "draft" ? null : new Date(now - DAYS * DAY_MS)
  formRows.push({ id: formId, title: def.title, publicId: hex(6), status: def.status, publishedAt, createdAt })

  const fields = [
    { id: uuid(), type: "short_text", label: "Your name" },
    { id: uuid(), type: "email", label: "Email address" },
  ]
  if (def.extra) fields.push({ id: uuid(), type: def.extra.type, label: def.extra.label, options: def.extra.options })
  fields.forEach((f, i) =>
    fieldRows.push({
      id: f.id,
      formId,
      type: f.type,
      label: f.label,
      required: i < 2,
      position: i,
      options: f.options ? f.options.map((label) => ({ id: uuid(), label })) : null,
      createdAt,
    }),
  )

  if (def.pop <= 0) continue

  for (let d = 0; d < DAYS; d++) {
    const dayStart = todayUTC - (DAYS - 1 - d) * DAY_MS
    const weekend = [0, 6].includes(new Date(dayStart).getUTCDay()) ? 0.6 : 1
    const trend = 0.6 + (d / DAYS) * 0.9
    const lambda = def.pop * trend * weekend * (0.7 + Math.random() * 0.6)
    const completes = Math.round(lambda)
    if (completes <= 0) continue

    const rate = clamp(def.rate + (Math.random() * 0.1 - 0.05), 0.3, 0.95)
    const views = Math.max(completes, Math.ceil(completes / rate))
    const starts = Math.min(views, completes + Math.round((views - completes) * (0.4 + Math.random() * 0.4)))

    for (let k = 0; k < completes; k++) {
      const subId = uuid()
      const ts = new Date(dayStart + rnd(DAY_MS))
      const meta = { device: weighted(DEVICES) }
      if (Math.random() > 0.08) meta.country = weighted(COUNTRIES)
      Object.assign(meta, weighted(SOURCES))
      subRows.push({ id: subId, formId, meta, ts })

      const name = pick(NAMES)
      answerRows.push({ submissionId: subId, fieldId: fields[0].id, question: fields[0].label, type: "short_text", value: name, ts })
      answerRows.push({ submissionId: subId, fieldId: fields[1].id, question: fields[1].label, type: "email", value: `${slug(name)}@${pick(DOMAINS)}`, ts })
      if (def.extra) {
        answerRows.push({ submissionId: subId, fieldId: fields[2].id, question: fields[2].label, type: def.extra.type, value: extraValue(def.extra), ts })
      }

      const vk = hex(8)
      eventRows.push({ formId, type: "view", submissionId: null, visitorKey: vk, ts: new Date(ts.getTime() - rnd(120000)) })
      eventRows.push({ formId, type: "start", submissionId: null, visitorKey: vk, ts: new Date(ts.getTime() - rnd(60000)) })
      eventRows.push({ formId, type: "complete", submissionId: subId, visitorKey: vk, ts })
    }

    for (let v = 0; v < views - completes; v++) {
      eventRows.push({ formId, type: "view", submissionId: null, visitorKey: hex(8), ts: new Date(dayStart + rnd(DAY_MS)) })
    }
    for (let s = 0; s < starts - completes; s++) {
      eventRows.push({ formId, type: "start", submissionId: null, visitorKey: hex(8), ts: new Date(dayStart + rnd(DAY_MS)) })
    }
  }
}

console.log(`Generated: ${formRows.length} forms, ${fieldRows.length} fields, ${subRows.length} submissions, ${answerRows.length} answers, ${eventRows.length} events`)

const t0 = Date.now()
// Multi-row bulk inserts: one INSERT carries up to `size` rows, so the whole
// seed is ~15 queries instead of thousands of round-trips. jsonb cells are
// wrapped with sql.json() so they bind as jsonb.
const bulk = async (table, rows, size = 1000) => {
  for (let i = 0; i < rows.length; i += size) {
    await sql`insert into ${sql(table)} ${sql(rows.slice(i, i + size))}`
  }
}

await bulk(
  "forms",
  formRows.map((r) => ({
    id: r.id,
    workspace_id: ws.id,
    created_by_id: userId,
    title: r.title,
    public_id: r.publicId,
    status: r.status,
    settings: sql.json({ _seed: true }),
    published_at: r.publishedAt,
    created_at: r.createdAt,
    updated_at: r.createdAt,
  })),
)

await bulk(
  "form_fields",
  fieldRows.map((r) => ({
    id: r.id,
    form_id: r.formId,
    type: r.type,
    label: r.label,
    required: r.required,
    position: r.position,
    options: r.options ? sql.json(r.options) : null,
    created_at: r.createdAt,
    updated_at: r.createdAt,
  })),
)

await bulk(
  "submissions",
  subRows.map((r) => ({
    id: r.id,
    form_id: r.formId,
    workspace_id: ws.id,
    status: "completed",
    mode: "classic",
    meta: sql.json(r.meta),
    completed_at: r.ts,
    created_at: r.ts,
    updated_at: r.ts,
  })),
)

await bulk(
  "answers",
  answerRows.map((r) => ({
    submission_id: r.submissionId,
    field_id: r.fieldId,
    question: r.question,
    type: r.type,
    value: sql.json(r.value),
    created_at: r.ts,
    updated_at: r.ts,
  })),
)

await bulk(
  "form_events",
  eventRows.map((r) => ({
    form_id: r.formId,
    type: r.type,
    submission_id: r.submissionId,
    visitor_key: r.visitorKey,
    created_at: r.ts,
  })),
)

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. Reload /forms to see the demo company.`)
await sql.end()
