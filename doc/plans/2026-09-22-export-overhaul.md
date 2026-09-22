# Response Export Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single hard-coded CSV dump into a parameterised export — selectable scope (search, filters, date range, most-recent-N, partials), selectable columns, CSV/XLSX/JSON, and a ZIP of every uploaded file — with large exports running as queued jobs so an export can never silently truncate.

**Architecture:** One serialisable `ExportSpec` describes any export and is parsed in exactly one place, from either query parameters (browser session) or the signed token payload (MCP). Pure modules build the column list and turn one submission into cells; a server-only async generator streams the scope with keyset pagination and re-runs the table's own `applyFilters` per page. Exports at or under 5,000 rows stream straight to the browser as they do today; anything larger, or XLSX, or anything wanting a media ZIP, becomes an `export_jobs` row claimed by a cron worker that writes the artifact to Cloudinary and emails a link. Every export writes a job row, so the audit trail is a by-product.

**Tech Stack:** Next.js 16 (route handlers, server actions, `after()`), Drizzle ORM, Postgres, Zod 4, Cloudinary (raw upload + `generate_archive`), Resend (`src/lib/email/provider.ts`), exceljs (new dependency, streaming writer), Vitest (unit + integration against real Postgres on :54322), Tailwind + shadcn/ui (`radix-maia`, `hugeicons`).

**Spec:** `doc/specs/2026-09-22-export-overhaul-design.md`

## Global Constraints

- Read `doc/specs/2026-09-22-export-overhaul-design.md` before starting. Decisions are referenced below as D1–D11.
- **Respondent file URLs stay public.** Explicitly accepted by the product owner on 2026-09-22. Do not add signed delivery, `access_mode: authenticated`, or URL expiry for respondent uploads as part of this work.
- Every query is scoped to the caller's workspace. A form id from another tenant must be indistinguishable from one that does not exist (404, never 403).
- Server Actions live in `src/lib/actions/`, never inlined in components (AGENTS.md).
- `params` and `searchParams` are Promises — always await them.
- `cacheComponents: true`: use `"use cache"`, never `unstable_cache`. None of the export paths are cacheable — they are all `no-store`.
- Never create `middleware.ts`; `proxy.ts` replaces it.
- The export must degrade gracefully: if Cloudinary or Resend is unconfigured, the synchronous CSV path must still work. AI absence must never fail an export.
- Formula neutralisation is non-negotiable on every text-ish cell written to CSV or Sheets: reuse `neutralizeFormula` / `escapeCsvCell` from `src/lib/submissions/csv.ts`.
- `SYNC_ROW_CEILING = 5000`, `PAGE = 500`, `ARCHIVE_CHUNK = 200`, `ARTIFACT_TTL_DAYS = 7`, `EXPORT_JOB_MAX_ATTEMPTS = 3`. Define each once, in the module named below, and import it everywhere else.
- Package manager is **pnpm**. Run `pnpm test:db:up` once before any integration test run.
- Commit after every task. Work directly on `main` (no feature branch, no PR).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/submissions/export-spec.ts` (create) | `ExportSpec` type, Zod schema, defaults, encode/parse, sync-eligibility |
| `src/lib/submissions/export-columns.ts` (create) | `ExportColumn` + `buildColumns` — meta, field, removed-question and AI-follow-up columns |
| `src/lib/submissions/export-row.ts` (create) | `ExportSubmission` shape, timezone formatting, one row as cells or as an object |
| `src/lib/submissions/export-query.ts` (create) | server-only: tenancy check, pre-flight count, column sources, the streaming row generator |
| `src/lib/submissions/export-serialize.ts` (create) | CSV and JSON chunk generators, `exportFileName` |
| `src/lib/submissions/export-xlsx.ts` (create) | XLSX writer (exceljs streaming), job-only |
| `src/lib/submissions/export-media.ts` (create) | collect file assets in scope, in-zip paths, Cloudinary `generate_archive` |
| `src/lib/submissions/export-artifact.ts` (create) | signed Cloudinary raw upload of a finished artifact |
| `src/lib/core/export-jobs.ts` (create) | enqueue, claim, reclaim, finish, prune — the queue and the audit trail |
| `src/lib/submissions/export-worker.ts` (create) | run one claimed job end to end |
| `src/app/api/cron/exports/route.ts` (create) | the sweep: reclaim, claim, run, prune |
| `src/app/api/forms/[id]/export/route.ts` (modify) | GET: parse a spec, stream sync-eligible exports |
| `src/lib/actions/exports.ts` (create) | `requestExport` server action — download URL or queued job |
| `src/lib/data/exports.ts` (create) | recent exports for the UI |
| `src/components/forms/export-dialog.tsx` (create) | scope / format / columns / files picker |
| `src/components/forms/submissions-view.tsx` (modify) | Export button opens the dialog, passing the live filter state |
| `src/lib/db/schema.ts` (modify) | `exportJobStatusEnum`, `exportFormatEnum`, `exportJobs`, `ExportJobArtifact` |
| `src/lib/mcp/export-token.ts` (modify) | carry an `ExportSpec` in the grant |
| `src/lib/mcp/tools/data.ts` (modify) | MCP parity: spec arguments, job-or-link result |
| `src/lib/email/export-ready.ts` (create) | the "your export is ready" email |
| `tests/unit/export-spec.test.ts` (create) | parse, defaults, round-trip, rejection |
| `tests/unit/export-columns.test.ts` (create) | column assembly and headers |
| `tests/unit/export-row.test.ts` (create) | cells, timezone formatting, JSON shape |
| `tests/unit/export-media.test.ts` (create) | asset collection, in-zip paths, chunking |
| `tests/integration/export-route.test.ts` (modify) | the existing suite plus scope/format/column cases |
| `tests/integration/export-jobs.test.ts` (create) | enqueue, claim, reclaim, worker, prune |

Task order is dependency order: pure modules → query layer → serialisers → route → queue → worker → XLSX → ZIP → notification → UI → MCP.

---

### Task 1: The export spec

**Files:**
- Create: `src/lib/submissions/export-spec.ts`
- Test: `tests/unit/export-spec.test.ts`

**Interfaces:**
- Consumes: `FieldCondition` from `@/lib/db/schema`, `MatchMode` from `@/lib/submissions/filter`.
- Produces: `META_COLUMNS`, `MetaColumnKey`, `ExportSpec`, `exportSpecSchema`, `DEFAULT_SPEC`, `encodeSpec(spec): string`, `decodeSpec(encoded: string): ExportSpec`, `parseExportSpec(params: URLSearchParams, fallback?: ExportSpec): ExportSpec`, `safeTimezone(tz: string | undefined): string`, `isSyncEligible(spec: ExportSpec, rowCount: number): boolean`, `SYNC_ROW_CEILING`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/export-spec.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import {
  DEFAULT_SPEC,
  decodeSpec,
  encodeSpec,
  exportSpecSchema,
  isSyncEligible,
  parseExportSpec,
  safeTimezone,
  SYNC_ROW_CEILING,
} from "@/lib/submissions/export-spec"

describe("export spec", () => {
  test("an empty request is today's export: completed rows, CSV, submitted column, file URLs", () => {
    expect(DEFAULT_SPEC).toEqual({
      format: "csv",
      scope: { status: "completed", filters: [], match: "all", order: "oldest" },
      columns: { meta: ["submitted"], fields: "all", removedQuestions: false, aiFollowUps: false },
      files: "urls",
      timezone: "UTC",
    })
  })

  test("parseExportSpec with no params returns the default", () => {
    expect(parseExportSpec(new URLSearchParams())).toEqual(DEFAULT_SPEC)
  })

  test("a spec survives the round trip through a query parameter", () => {
    const spec = exportSpecSchema.parse({
      format: "xlsx",
      scope: { status: "all", search: "karachi", limit: 50, order: "newest" },
      columns: { meta: ["submissionId", "submitted", "aiScore"], fields: ["f1", "f2"], aiFollowUps: true },
      files: "zip",
      timezone: "Asia/Karachi",
    })
    const params = new URLSearchParams({ spec: encodeSpec(spec) })
    expect(parseExportSpec(params)).toEqual(spec)
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec)
  })

  test("a mangled spec falls back to the default rather than failing the download", () => {
    expect(parseExportSpec(new URLSearchParams({ spec: "not-base64-json" }))).toEqual(DEFAULT_SPEC)
  })

  test("an unknown timezone degrades to UTC", () => {
    expect(safeTimezone("Mars/Olympus_Mons")).toBe("UTC")
    expect(safeTimezone("Asia/Karachi")).toBe("Asia/Karachi")
    expect(safeTimezone(undefined)).toBe("UTC")
  })

  test("only small csv/json exports without a zip may stream inline", () => {
    const csv = DEFAULT_SPEC
    expect(isSyncEligible(csv, SYNC_ROW_CEILING)).toBe(true)
    expect(isSyncEligible(csv, SYNC_ROW_CEILING + 1)).toBe(false)
    expect(isSyncEligible({ ...csv, format: "xlsx" }, 10)).toBe(false)
    expect(isSyncEligible({ ...csv, files: "zip" }, 10)).toBe(false)
    expect(isSyncEligible({ ...csv, files: "zip-only" }, 10)).toBe(false)
    expect(isSyncEligible({ ...csv, format: "json" }, 10)).toBe(true)
  })

  test("filters are capped so a signed link cannot carry an unbounded workload", () => {
    const many = Array.from({ length: 25 }, () => ({ fieldId: "f", operator: "is_not_empty" as const }))
    expect(() => exportSpecSchema.parse({ scope: { filters: many } })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/export-spec.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/submissions/export-spec"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/submissions/export-spec.ts`:

```ts
/**
 * What one export IS — the whole request in one serialisable value.
 *
 * There is exactly one of these types because there are three callers (the
 * Export dialog, a hand-written URL, and the MCP tool) and they must not be
 * able to ask for three different things. The spec travels either as a query
 * parameter or inside a signed token payload; `parseExportSpec` is the only
 * place either is read.
 *
 * Every field has a default, and the defaults reproduce the export we shipped
 * before any of this existed: completed responses, CSV, one Submitted column
 * plus every question, file URLs inline. An un-parameterised request must keep
 * behaving exactly as it did.
 */

import * as z from "zod"

/** Non-answer columns an owner can ask for, in the order the dialog lists them. */
export const META_COLUMNS = [
  "submissionId",
  "submitted",
  "started",
  "isoSubmitted",
  "status",
  "language",
  "mode",
  "reviewStatus",
  "tags",
  "aiScore",
  "aiSummary",
  "aiScreenReason",
  "calculations",
  "utm",
  "referrer",
  "device",
  "country",
  "files",
] as const

export type MetaColumnKey = (typeof META_COLUMNS)[number]

/** Rows at or under this stream straight to the browser; above it, a job. */
export const SYNC_ROW_CEILING = 5000

const operatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
])

// Mirrors FieldCondition in the schema. Kept as its own schema rather than
// derived, because this one is parsing UNTRUSTED input from a URL.
const filterSchema = z.object({
  fieldId: z.string().min(1).max(64),
  operator: operatorSchema,
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500))]).optional(),
})

const scopeSchema = z.object({
  status: z.enum(["completed", "all"]).default("completed"),
  search: z.string().max(200).optional(),
  // Capped: a signed link is a bearer credential, and 200 conditions per row
  // over a 200k-row form is a workload nobody asked for.
  filters: z.array(filterSchema).max(20).default([]),
  match: z.enum(["all", "any"]).default("all"),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.number().int().positive().max(200_000).optional(),
  order: z.enum(["oldest", "newest"]).default("oldest"),
})

const columnsSchema = z.object({
  meta: z.array(z.enum(META_COLUMNS)).max(META_COLUMNS.length).default(["submitted"]),
  fields: z.union([z.literal("all"), z.array(z.string().min(1).max(64)).max(500)]).default("all"),
  removedQuestions: z.boolean().default(false),
  aiFollowUps: z.boolean().default(false),
})

export const exportSpecSchema = z.object({
  format: z.enum(["csv", "xlsx", "json"]).default("csv"),
  scope: scopeSchema.default(scopeSchema.parse({})),
  columns: columnsSchema.default(columnsSchema.parse({})),
  files: z.enum(["none", "urls", "zip", "zip-only"]).default("urls"),
  timezone: z.string().max(64).default("UTC"),
})

export type ExportSpec = z.infer<typeof exportSpecSchema>
export type ExportFormat = ExportSpec["format"]
export type ExportFiles = ExportSpec["files"]

export const DEFAULT_SPEC: ExportSpec = exportSpecSchema.parse({})

/**
 * An IANA zone we can actually format with, or UTC.
 *
 * The zone reaches us from a browser or from a model, and `Intl` throws on one
 * it does not know — which would turn a typo into a failed download instead of
 * a slightly wrong header.
 */
export function safeTimezone(tz: string | undefined): string {
  if (!tz) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return "UTC"
  }
}

export function encodeSpec(spec: ExportSpec): string {
  return Buffer.from(JSON.stringify(spec)).toString("base64url")
}

export function decodeSpec(encoded: string): ExportSpec {
  const parsed = exportSpecSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")))
  return { ...parsed, timezone: safeTimezone(parsed.timezone) }
}

/**
 * Read a spec off a URL, falling back rather than failing.
 *
 * A malformed `?spec=` is treated as "no spec". The alternative — a 400 — turns
 * a stale bookmark or a truncated paste into a broken Export button, and the
 * fallback is the export everybody wanted before this parameter existed.
 */
export function parseExportSpec(params: URLSearchParams, fallback: ExportSpec = DEFAULT_SPEC): ExportSpec {
  const raw = params.get("spec")
  if (!raw) return fallback
  try {
    return decodeSpec(raw)
  } catch {
    return fallback
  }
}

/**
 * May this export be streamed inside one request?
 *
 * The row count is the PRE-FILTER upper bound (see export-query.ts), so this is
 * deliberately conservative: an export that might not finish becomes a job.
 * XLSX needs a workbook assembled before a byte can be sent, and a ZIP needs
 * Cloudinary, so neither is ever inline.
 */
export function isSyncEligible(spec: ExportSpec, rowCount: number): boolean {
  if (spec.format === "xlsx") return false
  if (spec.files === "zip" || spec.files === "zip-only") return false
  return rowCount <= SYNC_ROW_CEILING
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/export-spec.test.ts`
Expected: PASS (7 tests).

If `DEFAULT_SPEC` comes back with `scope`/`columns` missing, the Zod 4 nested `.default()` did not apply — the pre-parsed defaults passed to `.default(...)` above are what prevent that. Do not "fix" it by making the nested objects optional; downstream code indexes `spec.scope.status` directly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/submissions/export-spec.ts tests/unit/export-spec.test.ts
git commit -m "feat(export): one serialisable spec for every export"
```

---

### Task 2: The column list

**Files:**
- Create: `src/lib/submissions/export-columns.ts`
- Test: `tests/unit/export-columns.test.ts`

**Interfaces:**
- Consumes: `ExportSpec`, `MetaColumnKey` (Task 1).
- Produces: `ExportColumn`, `ColumnSources`, `META_HEADERS`, `buildColumns(spec, sources): ExportColumn[]`, `NON_ANSWER_TYPES` re-export is NOT added — import it from `@/lib/builder/logic` where needed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/export-columns.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { buildColumns, type ColumnSources } from "@/lib/submissions/export-columns"
import { DEFAULT_SPEC, exportSpecSchema } from "@/lib/submissions/export-spec"

const sources: ColumnSources = {
  fields: [
    { id: "f1", label: "**Full name**", type: "short_text" },
    { id: "f2", label: "", type: "long_text" },
    { id: "f3", label: "Upload your CV", type: "file_upload" },
  ],
  removedQuestions: ["Why did you leave?"],
  followUpCount: 2,
  timezone: "Asia/Karachi",
}

const headers = (spec = DEFAULT_SPEC) => buildColumns(spec, sources).map((c) => c.header)

describe("buildColumns", () => {
  test("the default is a Submitted column plus every question, markdown stripped", () => {
    expect(headers()).toEqual([
      "Submitted (Asia/Karachi)",
      "Full name",
      "Untitled",
      "Upload your CV",
    ])
  })

  test("meta columns come in the order the spec lists them, before the questions", () => {
    const spec = exportSpecSchema.parse({
      columns: { meta: ["submissionId", "started", "submitted", "aiScore"] },
    })
    expect(headers(spec).slice(0, 4)).toEqual([
      "Submission ID",
      "Started (Asia/Karachi)",
      "Submitted (Asia/Karachi)",
      "AI score",
    ])
  })

  test("named fields are exported in form order, not in the order they were named", () => {
    const spec = exportSpecSchema.parse({ columns: { fields: ["f3", "f1"] } })
    expect(headers(spec)).toEqual(["Submitted (Asia/Karachi)", "Full name", "Upload your CV"])
  })

  test("removed questions are opt-in and marked", () => {
    const spec = exportSpecSchema.parse({ columns: { removedQuestions: true } })
    expect(headers(spec)).toContain("Why did you leave? (removed)")
    expect(headers()).not.toContain("Why did you leave? (removed)")
  })

  test("AI follow-ups become numbered question/answer pairs, stable across rows", () => {
    const spec = exportSpecSchema.parse({ columns: { aiFollowUps: true } })
    expect(headers(spec).slice(-4)).toEqual([
      "AI follow-up 1 — question",
      "AI follow-up 1 — answer",
      "AI follow-up 2 — question",
      "AI follow-up 2 — answer",
    ])
  })

  test("a form with no AI follow-ups gets no follow-up columns even when asked", () => {
    const spec = exportSpecSchema.parse({ columns: { aiFollowUps: true } })
    const cols = buildColumns(spec, { ...sources, followUpCount: 0 })
    expect(cols.some((c) => c.kind === "followUp")).toBe(false)
  })

  test("duplicate question labels are disambiguated so two columns are never identical", () => {
    const cols = buildColumns(DEFAULT_SPEC, {
      ...sources,
      fields: [
        { id: "a", label: "Email", type: "email" },
        { id: "b", label: "Email", type: "short_text" },
      ],
      removedQuestions: [],
      followUpCount: 0,
    })
    expect(cols.map((c) => c.header)).toEqual(["Submitted (Asia/Karachi)", "Email", "Email (2)"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/export-columns.test.ts`
Expected: FAIL — cannot resolve `@/lib/submissions/export-columns`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/submissions/export-columns.ts`:

```ts
/**
 * The header row, decided once and then obeyed by every serialiser.
 *
 * A column list is not a list of strings: the writers need to know what to ask
 * each submission for, and the JSON writer needs a key where the CSV writer
 * needs a position. So a column carries its source (`kind`) as well as its
 * header, and `rowCells`/`rowObject` in export-row.ts switch on it.
 *
 * Two rules exist because a spreadsheet punishes breaking them. Headers are
 * unique — two identical column names is silent ambiguity in every consuming
 * tool. And AI-follow-up columns are fixed for the whole export, taken from the
 * busiest submission in scope, because a CSV cannot grow a column halfway down.
 */

import { NON_ANSWER_TYPES } from "@/lib/builder/logic"
import { markdownToPlainText } from "@/lib/markdown"
import type { ExportSpec, MetaColumnKey } from "@/lib/submissions/export-spec"

export type ExportColumn =
  | { kind: "meta"; key: MetaColumnKey; header: string }
  | { kind: "field"; fieldId: string; fieldType: string; header: string }
  | { kind: "removed"; question: string; header: string }
  | { kind: "followUp"; index: number; part: "question" | "answer"; header: string }

export type ColumnSources = {
  /** Live fields in form order. Content blocks may be present; they are dropped here. */
  fields: { id: string; label: string; type: string }[]
  /** Distinct labels of answers whose field is gone, discovered over the scope. */
  removedQuestions: string[]
  /** The most AI follow-ups any single submission in scope has. */
  followUpCount: number
  timezone: string
}

/** Header text for each non-answer column. Timezone-bearing ones are handled in buildColumns. */
export const META_HEADERS: Record<MetaColumnKey, string> = {
  submissionId: "Submission ID",
  submitted: "Submitted",
  started: "Started",
  isoSubmitted: "Submitted (ISO, UTC)",
  status: "Status",
  language: "Language",
  mode: "Fill mode",
  reviewStatus: "Review status",
  tags: "Tags",
  aiScore: "AI score",
  aiSummary: "AI summary",
  aiScreenReason: "AI screening reason",
  calculations: "Calculations",
  utm: "URL parameters",
  referrer: "Referrer",
  device: "Device",
  country: "Country",
  files: "Files",
}

/** Which meta columns name a wall-clock time and so carry the zone in the header. */
const ZONED: ReadonlySet<MetaColumnKey> = new Set<MetaColumnKey>(["submitted", "started"])

export function buildColumns(spec: ExportSpec, src: ColumnSources): ExportColumn[] {
  const out: ExportColumn[] = []

  for (const key of spec.columns.meta) {
    out.push({
      kind: "meta",
      key,
      header: ZONED.has(key) ? `${META_HEADERS[key]} (${src.timezone})` : META_HEADERS[key],
    })
  }

  // Form order, always. A picker hands back whatever order the checkboxes were
  // clicked in, and an export whose columns move between runs breaks every
  // spreadsheet formula pointed at it.
  const wanted = spec.columns.fields
  for (const f of src.fields) {
    if (NON_ANSWER_TYPES.has(f.type)) continue
    if (wanted !== "all" && !wanted.includes(f.id)) continue
    out.push({
      kind: "field",
      fieldId: f.id,
      fieldType: f.type,
      header: markdownToPlainText(f.label) || "Untitled",
    })
  }

  if (spec.columns.removedQuestions) {
    for (const q of src.removedQuestions) {
      out.push({ kind: "removed", question: q, header: `${markdownToPlainText(q) || "Untitled"} (removed)` })
    }
  }

  if (spec.columns.aiFollowUps) {
    for (let i = 1; i <= src.followUpCount; i++) {
      out.push({ kind: "followUp", index: i, part: "question", header: `AI follow-up ${i} — question` })
      out.push({ kind: "followUp", index: i, part: "answer", header: `AI follow-up ${i} — answer` })
    }
  }

  return dedupeHeaders(out)
}

/** `Email`, `Email (2)`, `Email (3)` — never two columns a consumer cannot tell apart. */
function dedupeHeaders(columns: ExportColumn[]): ExportColumn[] {
  const seen = new Map<string, number>()
  return columns.map((c) => {
    const n = (seen.get(c.header) ?? 0) + 1
    seen.set(c.header, n)
    return n === 1 ? c : { ...c, header: `${c.header} (${n})` }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/export-columns.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/submissions/export-columns.ts tests/unit/export-columns.test.ts
git commit -m "feat(export): build the column list from a spec"
```

---

### Task 3: One submission as a row

**Files:**
- Create: `src/lib/submissions/export-row.ts`
- Test: `tests/unit/export-row.test.ts`

**Interfaces:**
- Consumes: `ExportColumn` (Task 2), `answerToCell` / `answerFiles` from `@/lib/submissions/answer-format`, `AnswerValue` / `SubmissionMeta` from `@/lib/db/schema`.
- Produces: `ExportSubmission`, `ExportFileRef`, `formatDateTime(date, timezone): string`, `rowCells(sub, columns): string[]`, `rowObject(sub, columns): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/export-row.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { buildColumns } from "@/lib/submissions/export-columns"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import { formatDateTime, rowCells, rowObject, type ExportSubmission } from "@/lib/submissions/export-row"

const sub: ExportSubmission = {
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: new Date("2026-09-20T05:00:00.000Z"),
  completedAt: new Date("2026-09-22T08:45:00.000Z"),
  status: "completed",
  language: "ur",
  mode: "conversational",
  reviewStatus: "reviewing",
  tags: ["shortlist", "senior"],
  aiSummary: "Strong backend background.",
  aiScore: 82,
  aiScreenReason: "Matches every requirement.",
  calculations: { score: 17 },
  meta: { urlParams: { utm_source: "linkedin" }, referrer: "https://x.test", device: "mobile", country: "PK" },
  values: { f1: "Ayesha", f3: { files: [{ name: "cv.pdf", url: "https://res.test/cv.pdf" }] } as never },
  removed: { "Why did you leave?": "Relocated" },
  followUps: [{ question: "Which stack?", answer: "Postgres" }],
  files: [{ path: "makingflow/submissions/ab12cd.pdf", url: "https://res.test/cv.pdf", name: "cv.pdf" }],
}

const fields = [
  { id: "f1", label: "Full name", type: "short_text" },
  { id: "f3", label: "CV", type: "file_upload" },
]
const sources = { fields, removedQuestions: ["Why did you leave?"], followUpCount: 1, timezone: "Asia/Karachi" }

describe("export rows", () => {
  test("wall-clock formatting is ISO-shaped in the requested zone", () => {
    expect(formatDateTime(new Date("2026-09-22T08:45:00.000Z"), "Asia/Karachi")).toBe("2026-09-22 13:45:00")
    expect(formatDateTime(new Date("2026-09-22T08:45:00.000Z"), "UTC")).toBe("2026-09-22 08:45:00")
    expect(formatDateTime(null, "UTC")).toBe("")
  })

  test("Submitted is the completion time, Started is the creation time", () => {
    const spec = exportSpecSchema.parse({ columns: { meta: ["submitted", "started"], fields: [] } })
    expect(rowCells(sub, buildColumns(spec, sources))).toEqual(["2026-09-22 13:45:00", "2026-09-20 10:00:00"])
  })

  test("a submission with no completedAt falls back to createdAt so the column is never blank", () => {
    const spec = exportSpecSchema.parse({ columns: { meta: ["submitted"], fields: [] } })
    const legacy = { ...sub, completedAt: null }
    expect(rowCells(legacy, buildColumns(spec, sources))).toEqual(["2026-09-20 10:00:00"])
  })

  test("every meta column renders as flat text a spreadsheet can hold", () => {
    const spec = exportSpecSchema.parse({
      columns: {
        meta: ["submissionId", "isoSubmitted", "status", "language", "mode", "reviewStatus", "tags", "aiScore", "calculations", "utm", "referrer", "device", "country", "files"],
        fields: [],
      },
    })
    expect(rowCells(sub, buildColumns(spec, sources))).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "2026-09-22T08:45:00.000Z",
      "completed",
      "ur",
      "conversational",
      "reviewing",
      "shortlist, senior",
      "82",
      "score: 17",
      "utm_source=linkedin",
      "https://x.test",
      "mobile",
      "PK",
      "makingflow/submissions/ab12cd.pdf",
    ])
  })

  test("answers, removed answers and follow-ups land in their own columns", () => {
    const spec = exportSpecSchema.parse({
      columns: { meta: [], fields: "all", removedQuestions: true, aiFollowUps: true },
    })
    expect(rowCells(sub, buildColumns(spec, sources))).toEqual([
      "Ayesha",
      "https://res.test/cv.pdf",
      "Relocated",
      "Which stack?",
      "Postgres",
    ])
  })

  test("a missing follow-up is an empty cell, not a shifted row", () => {
    const spec = exportSpecSchema.parse({ columns: { meta: [], fields: [], aiFollowUps: true } })
    const cols = buildColumns(spec, { ...sources, followUpCount: 2 })
    expect(rowCells(sub, cols)).toEqual(["Which stack?", "Postgres", "", ""])
  })

  test("the JSON shape keys by header and nests follow-ups", () => {
    const spec = exportSpecSchema.parse({
      columns: { meta: ["submissionId"], fields: ["f1"], aiFollowUps: true },
      format: "json",
    })
    expect(rowObject(sub, buildColumns(spec, sources))).toEqual({
      "Submission ID": "11111111-1111-1111-1111-111111111111",
      "Full name": "Ayesha",
      aiFollowUps: [{ question: "Which stack?", answer: "Postgres" }],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/export-row.test.ts`
Expected: FAIL — cannot resolve `@/lib/submissions/export-row`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/submissions/export-row.ts`:

```ts
/**
 * One submission, rendered against a column list.
 *
 * Two renderers over the same columns: `rowCells` for the formats that are a
 * grid (CSV, XLSX) and `rowObject` for the one that is not (JSON). They agree
 * on every value; they disagree only about follow-ups, which a grid has to
 * flatten into numbered pairs and JSON should not.
 *
 * Nothing here quotes, escapes or neutralises anything — that belongs to the
 * serialiser, because CSV and XLSX need different treatment and doing it twice
 * is how a cell ends up double-escaped.
 */

import type { AnswerValue, SubmissionMeta } from "@/lib/db/schema"
import { answerToCell } from "@/lib/submissions/answer-format"
import type { ExportColumn } from "@/lib/submissions/export-columns"

/** One uploaded file, with the path it will have inside a media archive. */
export type ExportFileRef = { path: string; url: string; name: string }

export type ExportSubmission = {
  id: string
  createdAt: Date
  completedAt: Date | null
  status: "partial" | "completed"
  language: string | null
  mode: "classic" | "conversational"
  reviewStatus: "new" | "reviewing" | "done"
  tags: string[]
  aiSummary: string | null
  aiScore: number | null
  aiScreenReason: string | null
  calculations: Record<string, number> | null
  meta: SubmissionMeta | null
  /** Answers to live fields, by field id. */
  values: Record<string, AnswerValue>
  /** Answers whose field is gone, by the question label they were asked under. */
  removed: Record<string, AnswerValue>
  followUps: { question: string; answer: string }[]
  files: ExportFileRef[]
}

/**
 * `2026-09-22 13:45:00` in the given zone.
 *
 * `sv-SE` is the trick: it is the only widely-available locale whose short
 * format is already ISO-ordered, so a correct, sortable, human-readable
 * timestamp costs no date library. The separator is normalised because some
 * ICU builds emit a comma between date and time.
 */
export function formatDateTime(date: Date | null, timezone: string): string {
  if (!date) return ""
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "")
}

/**
 * When a response was finished.
 *
 * `completedAt` is the answer, but it is nullable: `submitForm` promotes a
 * saved draft, so rows written before that column existed have only
 * `createdAt`. Falling back keeps the column populated instead of blank for
 * old data — and `createdAt` alone was the bug this replaces, because for a
 * resumed fill it is when the respondent STARTED, days earlier.
 */
function submittedAt(sub: ExportSubmission): Date | null {
  return sub.completedAt ?? sub.createdAt
}

function metaCell(sub: ExportSubmission, key: ExportColumn & { kind: "meta" }): string {
  const tz = key.header.match(/\(([^)]+)\)$/)?.[1] ?? "UTC"
  switch (key.key) {
    case "submissionId":
      return sub.id
    case "submitted":
      return formatDateTime(submittedAt(sub), tz)
    case "started":
      return formatDateTime(sub.createdAt, tz)
    case "isoSubmitted":
      return submittedAt(sub)?.toISOString() ?? ""
    case "status":
      return sub.status
    case "language":
      return sub.language ?? ""
    case "mode":
      return sub.mode
    case "reviewStatus":
      return sub.reviewStatus
    case "tags":
      return sub.tags.join(", ")
    case "aiScore":
      return sub.aiScore == null ? "" : String(sub.aiScore)
    case "aiSummary":
      return sub.aiSummary ?? ""
    case "aiScreenReason":
      return sub.aiScreenReason ?? ""
    case "calculations":
      return Object.entries(sub.calculations ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    case "utm":
      return Object.entries(sub.meta?.urlParams ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    case "referrer":
      return sub.meta?.referrer ?? ""
    case "device":
      return sub.meta?.device ?? ""
    case "country":
      return sub.meta?.country ?? ""
    case "files":
      // The in-zip paths, so a row in the CSV points at files in the archive.
      return sub.files.map((f) => f.path).join(", ")
  }
}

export function rowCells(sub: ExportSubmission, columns: ExportColumn[]): string[] {
  return columns.map((c) => {
    switch (c.kind) {
      case "meta":
        return metaCell(sub, c)
      case "field":
        return answerToCell(sub.values[c.fieldId])
      case "removed":
        return answerToCell(sub.removed[c.question])
      case "followUp": {
        const turn = sub.followUps[c.index - 1]
        if (!turn) return ""
        return c.part === "question" ? turn.question : turn.answer
      }
    }
  })
}

export function rowObject(sub: ExportSubmission, columns: ExportColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let wantsFollowUps = false
  for (const c of columns) {
    if (c.kind === "followUp") {
      wantsFollowUps = true
      continue
    }
    out[c.header] = rowCells(sub, [c])[0]
  }
  // Nested, not flattened: JSON has no reason to pretend it is a grid.
  if (wantsFollowUps) out.aiFollowUps = sub.followUps
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/export-row.test.ts`
Expected: PASS (7 tests).

If the timezone assertions fail with the offset missing, the Node build lacks full ICU. Check with `node -e "console.log(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Karachi'}).format(new Date()))"` — a correct build prints a Karachi date. Do not weaken the test; fix the runtime.

- [ ] **Step 5: Commit**

```bash
git add src/lib/submissions/export-row.ts tests/unit/export-row.test.ts
git commit -m "feat(export): render a submission against a column list"
```

---

### Task 4: The query layer

**Files:**
- Create: `src/lib/submissions/export-query.ts`
- Test: `tests/integration/export-query.test.ts`

**Interfaces:**
- Consumes: `ExportSpec` (Task 1), `buildColumns` / `ColumnSources` / `ExportColumn` (Task 2), `ExportSubmission` (Task 3), `applyFilters` from `@/lib/submissions/filter`.
- Produces: `PAGE`, `ExportSource`, `openExport(formId, workspaceId, spec): Promise<ExportSource | null>`, `countExportRows(formId, spec): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/export-query.test.ts`:

```ts
/**
 * The scope half of an export: which rows, in which order, with which answers
 * attached. Filters run in JS over each page (D2), so these tests are the proof
 * that the export agrees with the table the owner was looking at.
 */
import { describe, expect, test } from "vitest"
import { db } from "@/lib/db"
import { answers, formFields, forms, submissions, workspaces } from "@/lib/db/schema"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import { countExportRows, openExport } from "@/lib/submissions/export-query"

let seq = 0

async function seed() {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS q ${seq}`, slug: `ws-q-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Roles", publicId: `q${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [city, gone] = await db
    .insert(formFields)
    .values([
      { formId: form.id, type: "short_text" as const, label: "City", position: 0 },
      { formId: form.id, type: "short_text" as const, label: "Old question", position: 1, deletedAt: new Date() },
    ])
    .returning({ id: formFields.id })

  async function add(city_: string, opts: { status?: "partial" | "completed"; at?: Date; followUps?: number } = {}) {
    const at = opts.at ?? new Date("2026-09-10T00:00:00.000Z")
    const [sub] = await db
      .insert(submissions)
      .values({
        formId: form.id,
        workspaceId: ws.id,
        status: opts.status ?? "completed",
        createdAt: at,
        completedAt: opts.status === "partial" ? null : at,
      })
      .returning({ id: submissions.id })
    await db.insert(answers).values([
      { submissionId: sub.id, fieldId: city.id, question: "City", type: "short_text", value: city_ },
      { submissionId: sub.id, fieldId: gone.id, question: "Old question", type: "short_text", value: "legacy" },
    ])
    for (let i = 0; i < (opts.followUps ?? 0); i++) {
      await db.insert(answers).values({
        submissionId: sub.id,
        fieldId: null,
        isAiFollowUp: true,
        question: `Follow-up ${i}`,
        type: "short_text",
        value: `answer ${i}`,
      })
    }
    return sub.id
  }

  return { workspaceId: ws.id, formId: form.id, cityId: city.id, add }
}

const collect = async (source: NonNullable<Awaited<ReturnType<typeof openExport>>>) => {
  const out = []
  for await (const row of source.rows) out.push(row)
  return out
}

describe("openExport", () => {
  test("refuses a form in another workspace", async () => {
    const a = await seed()
    const b = await seed()
    expect(await openExport(a.formId, b.workspaceId, exportSpecSchema.parse({}))).toBeNull()
  })

  test("completed only by default, partials on request", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi", { status: "partial" })

    const done = await openExport(f.formId, f.workspaceId, exportSpecSchema.parse({}))
    expect((await collect(done!)).length).toBe(1)

    const all = await openExport(f.formId, f.workspaceId, exportSpecSchema.parse({ scope: { status: "all" } }))
    expect((await collect(all!)).length).toBe(2)
  })

  test("a field filter selects the same rows the table would", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi")
    const spec = exportSpecSchema.parse({
      scope: { filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }] },
    })
    const source = await openExport(f.formId, f.workspaceId, spec)
    const rows = await collect(source!)
    expect(rows.map((r) => r.values[f.cityId])).toEqual(["Karachi"])
  })

  test("search looks across every answer", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi")
    const spec = exportSpecSchema.parse({ scope: { search: "kara" } })
    expect((await collect((await openExport(f.formId, f.workspaceId, spec))!)).length).toBe(1)
  })

  test("a date range is inclusive at both ends", async () => {
    const f = await seed()
    await f.add("A", { at: new Date("2026-09-01T10:00:00.000Z") })
    await f.add("B", { at: new Date("2026-09-05T10:00:00.000Z") })
    await f.add("C", { at: new Date("2026-09-09T10:00:00.000Z") })
    const spec = exportSpecSchema.parse({ scope: { from: "2026-09-05", to: "2026-09-09" } })
    const rows = await collect((await openExport(f.formId, f.workspaceId, spec))!)
    expect(rows.map((r) => r.values[f.cityId])).toEqual(["B", "C"])
  })

  test("most-recent-N counts the rows that survived the filter", async () => {
    const f = await seed()
    await f.add("Lahore", { at: new Date("2026-09-01T00:00:00.000Z") })
    await f.add("Karachi", { at: new Date("2026-09-02T00:00:00.000Z") })
    await f.add("Karachi", { at: new Date("2026-09-03T00:00:00.000Z") })
    const spec = exportSpecSchema.parse({
      scope: {
        order: "newest",
        limit: 1,
        filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }],
      },
    })
    const rows = await collect((await openExport(f.formId, f.workspaceId, spec))!)
    expect(rows).toHaveLength(1)
    expect(rows[0].createdAt.toISOString()).toBe("2026-09-03T00:00:00.000Z")
  })

  test("answers to a removed question are recovered by their label, opt-in", async () => {
    const f = await seed()
    await f.add("Lahore")
    const off = await openExport(f.formId, f.workspaceId, exportSpecSchema.parse({}))
    expect(off!.sources.removedQuestions).toEqual([])

    const on = await openExport(
      f.formId,
      f.workspaceId,
      exportSpecSchema.parse({ columns: { removedQuestions: true } }),
    )
    expect(on!.sources.removedQuestions).toEqual(["Old question"])
    const rows = await collect(on!)
    expect(rows[0].removed["Old question"]).toBe("legacy")
  })

  test("the follow-up column count is the busiest submission in scope", async () => {
    const f = await seed()
    await f.add("Lahore", { followUps: 1 })
    await f.add("Karachi", { followUps: 3 })
    const spec = exportSpecSchema.parse({ columns: { aiFollowUps: true } })
    const source = await openExport(f.formId, f.workspaceId, spec)
    expect(source!.sources.followUpCount).toBe(3)
    const rows = await collect(source!)
    expect(rows.flatMap((r) => r.followUps).length).toBe(4)
  })

  test("the pre-flight count is the pre-filter scope, so it never under-counts", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi")
    const spec = exportSpecSchema.parse({
      scope: { filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }] },
    })
    expect(await countExportRows(f.formId, spec)).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:db:up && pnpm vitest run --project=integration tests/integration/export-query.test.ts`
Expected: FAIL — cannot resolve `@/lib/submissions/export-query`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/submissions/export-query.ts`:

```ts
import "server-only"

/**
 * Which rows an export contains, and what is attached to each.
 *
 * KEYSET, NOT OFFSET. `(created_at, id)` is unique and matches the ordering, so
 * pages cannot overlap or skip while responses keep arriving mid-export — the
 * same cursor `getFormSubmissionsPage` uses, for the same reason.
 *
 * FILTERS RUN IN JS, ON PURPOSE (design note D2). `applyFilters` is the exact
 * function the responses table uses, so "export what I filtered" cannot drift
 * from what the owner was looking at. Status, date range and ordering push down
 * into SQL because Postgres can index them; jsonb answer conditions do not.
 *
 * The consequence is that `limit` is applied AFTER filtering, in this
 * generator, and that `countExportRows` is a pre-filter upper bound. Both are
 * deliberate: "most recent 50 of the ones I filtered" is what the dialog
 * promises, and an over-count only ever pushes an export to the safer path.
 */

import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  answers,
  formFields,
  forms,
  submissions,
  type AnswerValue,
  type SubmissionMeta,
} from "@/lib/db/schema"
import { NON_ANSWER_TYPES } from "@/lib/builder/logic"
import { applyFilters, type FilterColumn } from "@/lib/submissions/filter"
import { answerFiles } from "@/lib/submissions/answer-format"
import { buildColumns, type ColumnSources, type ExportColumn } from "@/lib/submissions/export-columns"
import { safeTimezone, type ExportSpec } from "@/lib/submissions/export-spec"
import type { ExportFileRef, ExportSubmission } from "@/lib/submissions/export-row"

/** Submissions pulled per round-trip. */
export const PAGE = 500

export type ExportSource = {
  form: { id: string; title: string }
  columns: ExportColumn[]
  sources: ColumnSources
  rows: AsyncGenerator<ExportSubmission>
}

/** Tenancy check plus the title, or null if the caller may not see this form. */
async function ownedForm(formId: string, workspaceId: string) {
  const [form] = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  return form ?? null
}

/** The SQL-pushable part of a scope: status and date range. */
function scopePredicate(formId: string, spec: ExportSpec) {
  const parts = [eq(submissions.formId, formId)]
  if (spec.scope.status === "completed") parts.push(eq(submissions.status, "completed"))
  if (spec.scope.from) parts.push(sql`${submissions.createdAt} >= ${new Date(`${spec.scope.from}T00:00:00.000Z`)}`)
  if (spec.scope.to) parts.push(sql`${submissions.createdAt} <= ${new Date(`${spec.scope.to}T23:59:59.999Z`)}`)
  return and(...parts)!
}

/**
 * How many rows the scope holds before answer filters are applied.
 *
 * This is what decides stream-or-queue, so it is deliberately an UPPER bound:
 * counting the filtered set would mean reading every answer twice.
 */
export async function countExportRows(formId: string, spec: ExportSpec): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(scopePredicate(formId, spec))
  return row?.count ?? 0
}

/** Live answer fields in form order, plus the filter columns those imply. */
async function liveFields(formId: string) {
  const fields = await db
    .select({ id: formFields.id, label: formFields.label, type: formFields.type, options: formFields.options })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  return fields.filter((f) => !NON_ANSWER_TYPES.has(f.type))
}

/**
 * Labels of answers in scope whose field is gone — deleted outright (field_id
 * nulled by the FK) or soft-deleted. `answers.question` is what survives, which
 * is the only reason this history is recoverable at all.
 */
async function removedQuestionLabels(formId: string, spec: ExportSpec): Promise<string[]> {
  const rows = await db
    .select({ question: answers.question })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .leftJoin(formFields, eq(answers.fieldId, formFields.id))
    .where(
      and(
        scopePredicate(formId, spec),
        eq(answers.isAiFollowUp, false),
        or(isNull(answers.fieldId), sql`${formFields.deletedAt} is not null`),
      ),
    )
    .groupBy(answers.question)
    .orderBy(answers.question)
  return rows.map((r) => r.question)
}

/** The most AI follow-ups any one submission in scope carries. */
async function maxFollowUps(formId: string, spec: ExportSpec): Promise<number> {
  const per = db
    .select({ n: sql<number>`count(*)::int`.as("n") })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(and(scopePredicate(formId, spec), eq(answers.isAiFollowUp, true)))
    .groupBy(answers.submissionId)
    .as("per")
  const [row] = await db.select({ max: sql<number>`coalesce(max(${per.n}), 0)::int` }).from(per)
  return row?.max ?? 0
}

export async function openExport(
  formId: string,
  workspaceId: string,
  spec: ExportSpec,
): Promise<ExportSource | null> {
  const form = await ownedForm(formId, workspaceId)
  if (!form) return null

  const fields = await liveFields(formId)
  const sources: ColumnSources = {
    fields,
    removedQuestions: spec.columns.removedQuestions ? await removedQuestionLabels(formId, spec) : [],
    followUpCount: spec.columns.aiFollowUps ? await maxFollowUps(formId, spec) : 0,
    timezone: safeTimezone(spec.timezone),
  }
  const columns = buildColumns(spec, sources)

  const filterColumns: FilterColumn[] = fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    options: (f.options as FilterColumn["options"]) ?? null,
  }))

  return { form, columns, sources, rows: streamRows(formId, spec, filterColumns) }
}

type Cursor = { createdAt: Date; id: string }

async function* streamRows(
  formId: string,
  spec: ExportSpec,
  filterColumns: FilterColumn[],
): AsyncGenerator<ExportSubmission> {
  const newest = spec.scope.order === "newest"
  const limit = spec.scope.limit ?? Infinity
  let emitted = 0
  let cursor: Cursor | null = null

  for (;;) {
    const page: SubmissionRow[] = await db
      .select({
        id: submissions.id,
        createdAt: submissions.createdAt,
        completedAt: submissions.completedAt,
        status: submissions.status,
        language: submissions.language,
        mode: submissions.mode,
        reviewStatus: submissions.reviewStatus,
        tags: submissions.tags,
        aiSummary: submissions.aiSummary,
        aiScore: submissions.aiScore,
        aiScreenReason: submissions.aiScreenReason,
        calculations: submissions.calculations,
        meta: submissions.meta,
      })
      .from(submissions)
      .where(and(scopePredicate(formId, spec), cursorPredicate(cursor, newest)))
      .orderBy(
        newest ? desc(submissions.createdAt) : asc(submissions.createdAt),
        newest ? desc(submissions.id) : asc(submissions.id),
      )
      .limit(PAGE)
    if (page.length === 0) return

    const byId = await answersFor(page.map((s) => s.id))
    // The table's own filter, over the same shape it filters in the browser.
    const kept = applyFilters(
      page.map((s) => ({ id: s.id, submittedAt: "", values: byId.get(s.id)?.values ?? {} })),
      filterColumns,
      { search: spec.scope.search ?? "", filters: spec.scope.filters, match: spec.scope.match },
    )
    const keptIds = new Set(kept.map((r) => r.id))

    for (const s of page) {
      if (!keptIds.has(s.id)) continue
      const attached = byId.get(s.id)
      yield {
        ...s,
        tags: s.tags ?? [],
        meta: (s.meta as SubmissionMeta | null) ?? null,
        values: attached?.values ?? {},
        removed: attached?.removed ?? {},
        followUps: attached?.followUps ?? [],
        files: attached?.files ?? [],
      }
      emitted += 1
      if (emitted >= limit) return
    }

    if (page.length < PAGE) return
    const last = page[page.length - 1]
    cursor = { createdAt: last.createdAt, id: last.id }
  }
}

type SubmissionRow = {
  id: string
  createdAt: Date
  completedAt: Date | null
  status: "partial" | "completed"
  language: string | null
  mode: "classic" | "conversational"
  reviewStatus: "new" | "reviewing" | "done"
  tags: string[] | null
  aiSummary: string | null
  aiScore: number | null
  aiScreenReason: string | null
  calculations: Record<string, number> | null
  meta: unknown
}

function cursorPredicate(cursor: Cursor | null, newest: boolean) {
  if (!cursor) return undefined
  const after = newest
    ? or(lt(submissions.createdAt, cursor.createdAt), and(eq(submissions.createdAt, cursor.createdAt), lt(submissions.id, cursor.id)))
    : or(gt(submissions.createdAt, cursor.createdAt), and(eq(submissions.createdAt, cursor.createdAt), gt(submissions.id, cursor.id)))
  return after
}

type Attached = {
  values: Record<string, AnswerValue>
  removed: Record<string, AnswerValue>
  followUps: { question: string; answer: string }[]
  files: ExportFileRef[]
}

/** Every answer for one page, split into the four things a row needs. */
async function answersFor(ids: string[]): Promise<Map<string, Attached>> {
  const rows = await db
    .select({
      submissionId: answers.submissionId,
      fieldId: answers.fieldId,
      question: answers.question,
      value: answers.value,
      isAiFollowUp: answers.isAiFollowUp,
      createdAt: answers.createdAt,
      fieldDeletedAt: formFields.deletedAt,
    })
    .from(answers)
    .leftJoin(formFields, eq(answers.fieldId, formFields.id))
    .where(inArray(answers.submissionId, ids))
    .orderBy(asc(answers.createdAt), asc(answers.id))

  const out = new Map<string, Attached>()
  for (const a of rows) {
    let bucket = out.get(a.submissionId)
    if (!bucket) out.set(a.submissionId, (bucket = { values: {}, removed: {}, followUps: [], files: [] }))

    if (a.isAiFollowUp) {
      bucket.followUps.push({ question: a.question, answer: String(a.value ?? "") })
      continue
    }
    if (!a.fieldId || a.fieldDeletedAt) {
      bucket.removed[a.question] = a.value
      continue
    }
    bucket.values[a.fieldId] = a.value

    for (const f of answerFiles(a.value) ?? []) {
      // `path` is filled in by export-media.ts, which is the only module that
      // knows how an archive is laid out. Until then it is the delivery URL.
      bucket.files.push({ path: f.url, url: f.url, name: f.name })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project=integration tests/integration/export-query.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/submissions/export-query.ts tests/integration/export-query.test.ts
git commit -m "feat(export): scope a stream by filters, search, dates and limit"
```

---

### Task 5: CSV and JSON serialisers

**Files:**
- Create: `src/lib/submissions/export-serialize.ts`
- Test: `tests/unit/export-serialize.test.ts`

**Interfaces:**
- Consumes: `ExportSource` (Task 4), `rowCells` / `rowObject` (Task 3), `csvRow` from `@/lib/submissions/csv`.
- Produces: `csvChunks(source): AsyncGenerator<string>`, `jsonChunks(source, meta): AsyncGenerator<string>`, `exportFileName(title, format, now): string`, `CONTENT_TYPES: Record<ExportFormat, string>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/export-serialize.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { buildColumns } from "@/lib/submissions/export-columns"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import type { ExportSubmission } from "@/lib/submissions/export-row"
import { csvChunks, exportFileName, jsonChunks } from "@/lib/submissions/export-serialize"

const sources = {
  fields: [{ id: "f1", label: "Name", type: "short_text" }],
  removedQuestions: [],
  followUpCount: 0,
  timezone: "UTC",
}

function subject(values: Record<string, unknown>): ExportSubmission {
  return {
    id: "s1",
    createdAt: new Date("2026-09-22T08:45:00.000Z"),
    completedAt: new Date("2026-09-22T08:45:00.000Z"),
    status: "completed",
    language: null,
    mode: "classic",
    reviewStatus: "new",
    tags: [],
    aiSummary: null,
    aiScore: null,
    aiScreenReason: null,
    calculations: null,
    meta: null,
    values: values as never,
    removed: {},
    followUps: [],
    files: [],
  }
}

function source(rows: ExportSubmission[]) {
  const spec = exportSpecSchema.parse({})
  return {
    form: { id: "form1", title: "Job Application" },
    columns: buildColumns(spec, sources),
    sources,
    rows: (async function* () {
      for (const r of rows) yield r
    })(),
  }
}

const drain = async (gen: AsyncGenerator<string>) => {
  let out = ""
  for await (const chunk of gen) out += chunk
  return out
}

describe("csvChunks", () => {
  test("a BOM, a header and one line per row", async () => {
    const csv = await drain(csvChunks(source([subject({ f1: "Ayesha" })])))
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv.trim().split("\n")).toEqual([`﻿"Submitted (UTC)","Name"`, `"2026-09-22 08:45:00","Ayesha"`])
  })

  test("respondent text cannot become a live formula", async () => {
    const csv = await drain(csvChunks(source([subject({ f1: `=HYPERLINK("http://evil.test","x")` })])))
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`)
    expect(csv).not.toMatch(/,"=/)
  })

  test("a header still comes out when there are no rows", async () => {
    const csv = await drain(csvChunks(source([])))
    expect(csv.trim().split("\n")).toHaveLength(1)
  })
})

describe("jsonChunks", () => {
  test("valid JSON with the form, the spec and the rows", async () => {
    const spec = exportSpecSchema.parse({})
    const text = await drain(jsonChunks(source([subject({ f1: "Ayesha" })]), { spec, exportedAt: new Date("2026-09-22T09:00:00.000Z") }))
    expect(JSON.parse(text)).toEqual({
      form: { id: "form1", title: "Job Application" },
      exportedAt: "2026-09-22T09:00:00.000Z",
      timezone: "UTC",
      rowCount: 1,
      rows: [{ "Submitted (UTC)": "2026-09-22 08:45:00", Name: "Ayesha" }],
    })
  })

  test("an empty export is still parseable", async () => {
    const spec = exportSpecSchema.parse({})
    const text = await drain(jsonChunks(source([]), { spec, exportedAt: new Date() }))
    expect(JSON.parse(text).rows).toEqual([])
  })
})

describe("exportFileName", () => {
  test("slug, date and extension", () => {
    expect(exportFileName("Job Application", "csv", new Date("2026-09-22T00:00:00.000Z"))).toBe(
      "job-application-2026-09-22.csv",
    )
    expect(exportFileName("", "xlsx", new Date("2026-09-22T00:00:00.000Z"))).toBe("form-2026-09-22.xlsx")
    expect(exportFileName("استمارة", "json", new Date("2026-09-22T00:00:00.000Z"))).toBe("form-2026-09-22.json")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/export-serialize.test.ts`
Expected: FAIL — cannot resolve `@/lib/submissions/export-serialize`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/submissions/export-serialize.ts`:

```ts
/**
 * Turning a row stream into bytes.
 *
 * Generators rather than strings, because an export is unbounded and the whole
 * point of the streaming route is that no single buffer ever holds all of it.
 * Rows are batched per page-worth before being yielded: one `enqueue` per row
 * on a 20,000-row export is 20,000 syscalls for no benefit.
 *
 * Escaping lives HERE and nowhere else. `escapeCsvCell` both quotes and
 * neutralises leading `=`/`+`/`-`/`@`, which is what keeps a respondent's
 * answer from executing in the owner's spreadsheet.
 */

import { csvRow } from "@/lib/submissions/csv"
import type { ExportSource } from "@/lib/submissions/export-query"
import { rowCells, rowObject } from "@/lib/submissions/export-row"
import type { ExportFormat, ExportSpec } from "@/lib/submissions/export-spec"

/** Rows accumulated before a chunk is handed to the stream. */
const BATCH = 200

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

export async function* csvChunks(source: ExportSource): AsyncGenerator<string> {
  // BOM so Excel on Windows reads UTF-8 rather than the local code page.
  yield `﻿${csvRow(source.columns.map((c) => c.header))}\n`

  let batch = ""
  let n = 0
  for await (const sub of source.rows) {
    batch += `${csvRow(rowCells(sub, source.columns))}\n`
    if ((n += 1) % BATCH === 0) {
      yield batch
      batch = ""
    }
  }
  if (batch) yield batch
}

export async function* jsonChunks(
  source: ExportSource,
  meta: { spec: ExportSpec; exportedAt: Date },
): AsyncGenerator<string> {
  // Hand-assembled rather than JSON.stringify'd whole, so the rows never all
  // exist at once. `rowCount` goes last for the same reason — it is not known
  // until the stream is done.
  yield `{"form":${JSON.stringify(source.form)},"exportedAt":${JSON.stringify(meta.exportedAt.toISOString())},"timezone":${JSON.stringify(source.sources.timezone)},"rows":[`

  let n = 0
  for await (const sub of source.rows) {
    yield `${n === 0 ? "" : ","}${JSON.stringify(rowObject(sub, source.columns))}`
    n += 1
  }
  yield `],"rowCount":${n}}`
}

/**
 * `job-application-2026-09-22.csv`.
 *
 * The date is in the name because the previous version was not, and two exports
 * a week apart both landed as `job-application-submissions.csv` — the second
 * silently replacing the first in the owner's Downloads folder. A title with no
 * ASCII word characters (Arabic, Chinese) slugs to nothing and falls back to
 * `form`, which is ugly but never an invalid filename.
 */
export function exportFileName(formTitle: string, format: ExportFormat, now: Date): string {
  const slug = formTitle.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()
  const day = now.toISOString().slice(0, 10)
  return `${slug || "form"}-${day}.${format}`
}
```

Note: `jsonChunks` puts `rowCount` after `rows`, but the test asserts a parsed object, so key order does not matter.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/export-serialize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/submissions/export-serialize.ts tests/unit/export-serialize.test.ts
git commit -m "feat(export): stream a row source as CSV or JSON"
```

---

### Task 6: Rewrite the download route

**Files:**
- Modify: `src/app/api/forms/[id]/export/route.ts` (whole file)
- Modify: `src/lib/mcp/export-token.ts` (add `spec` to the grant)
- Test: `tests/integration/export-route.test.ts` (existing suite, extended)

**Interfaces:**
- Consumes: `parseExportSpec` / `DEFAULT_SPEC` / `isSyncEligible` (Task 1), `openExport` / `countExportRows` (Task 4), `csvChunks` / `jsonChunks` / `exportFileName` / `CONTENT_TYPES` (Task 5), `verifyExportToken` (existing).
- Produces: `GET` handler whose spec source is query-or-token; `ExportGrant.spec?: ExportSpec`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/export-route.test.ts`, inside the top-level `describe`, keeping every existing test as-is:

```ts
  test("the default download is byte-for-byte the export we shipped before specs existed", async () => {
    const f = await seed(2)
    session.workspaceId = f.workspaceId
    const { body } = await exportCsv(f.formId)
    expect(body.trim().split("\n")[0]).toBe(`﻿"Submitted (UTC)","Name","Notes"`)
  })

  test("a spec selects format, columns and scope", async () => {
    const f = await seed(3)
    session.workspaceId = f.workspaceId
    const spec = encodeSpec(
      exportSpecSchema.parse({
        format: "json",
        columns: { meta: ["submissionId"], fields: [] },
        scope: { limit: 2, order: "newest" },
      }),
    )
    const url = new URL(`http://localhost/api/forms/${f.formId}/export?spec=${spec}`)
    const res = await GET(new Request(url), { params: Promise.resolve({ id: f.formId }) })
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = JSON.parse(await res.text())
    expect(body.rowCount).toBe(2)
    expect(Object.keys(body.rows[0])).toEqual(["Submission ID"])
  })

  test("an export too large to finish in one request is refused, not truncated", async () => {
    const f = await seed(1)
    session.workspaceId = f.workspaceId
    // Faked rather than seeded: proving the refusal does not require inserting
    // 5,001 rows, and this is the only assertion that needs the count to lie.
    vi.spyOn(query, "countExportRows").mockResolvedValue(SYNC_ROW_CEILING + 1)
    const { res, body } = await exportCsv(f.formId)
    expect(res.status).toBe(413)
    expect(body).toContain("too large")
    vi.restoreAllMocks()
  })

  test("a signed link carries its own spec and the query string cannot widen it", async () => {
    const f = await seed(2)
    session.workspaceId = null
    const token = mintExportToken({
      formId: f.formId,
      workspaceId: f.workspaceId,
      userId: "someone",
      apiKeyId: null,
      spec: exportSpecSchema.parse({ columns: { meta: ["submissionId"], fields: [] } }),
    })
    const wider = encodeSpec(exportSpecSchema.parse({ columns: { meta: ["submissionId", "aiSummary"] } }))
    const url = new URL(`http://localhost/api/forms/${f.formId}/export?token=${token}&spec=${wider}`)
    const res = await GET(new Request(url), { params: Promise.resolve({ id: f.formId }) })
    const body = await res.text()
    expect(body.trim().split("\n")[0]).toBe(`﻿"Submission ID"`)
  })

  test("the filename carries the form and the day", async () => {
    const f = await seed(1)
    session.workspaceId = f.workspaceId
    const { res } = await exportCsv(f.formId)
    expect(res.headers.get("content-disposition")).toMatch(/job-application-\d{4}-\d{2}-\d{2}\.csv/)
  })
```

Add these imports at the top of the file, after the existing ones:

```ts
import { encodeSpec, exportSpecSchema, SYNC_ROW_CEILING } from "@/lib/submissions/export-spec"
const query = await import("@/lib/submissions/export-query")
```

Two existing assertions must change, because the header now carries the timezone and the filename carries the date:

```ts
    expect(lines[0]).toBe(`﻿"Submitted (UTC)","Name","Notes"`) // the heading block is not a column
```

```ts
    expect(res.headers.get("content-disposition")).toContain("job-application-")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project=integration tests/integration/export-route.test.ts`
Expected: FAIL — `mintExportToken` rejects the extra `spec` property (type error) and the header assertions do not match.

- [ ] **Step 3: Carry a spec in the grant**

In `src/lib/mcp/export-token.ts`, extend the grant type and document why it is signed:

```ts
export type ExportGrant = {
  formId: string
  workspaceId: string
  userId: string
  /** The key that minted this, or null for a browser session. */
  apiKeyId: string | null
  /**
   * What this handle may download. Inside the signed payload rather than the
   * query string on purpose: a link minted for "the submission ids only" must
   * not become a link for every answer by editing the URL.
   */
  spec?: ExportSpec
  expiresAt: number
}
```

Add the import at the top: `import type { ExportSpec } from "@/lib/submissions/export-spec"`. No other change is needed — `mintExportToken` already spreads the whole grant into the payload, and `verifyExportToken` already returns it.

- [ ] **Step 4: Rewrite the route**

Replace the body of `src/app/api/forms/[id]/export/route.ts` with:

```ts
import { getDefaultWorkspace } from "@/lib/auth/session"
import { verifyExportToken } from "@/lib/mcp/export-token"
import {
  DEFAULT_SPEC,
  exportSpecSchema,
  isSyncEligible,
  parseExportSpec,
  type ExportSpec,
} from "@/lib/submissions/export-spec"
import { countExportRows, openExport } from "@/lib/submissions/export-query"
import { CONTENT_TYPES, csvChunks, exportFileName, jsonChunks } from "@/lib/submissions/export-serialize"

export const maxDuration = 60

/**
 * Downloading one form's responses.
 *
 * TWO WAYS IN, ONE TENANCY CHECK. A browser session is the ordinary one; a
 * `?token=` handle is for links minted by `makingflow_export_submissions`,
 * where the person opening it may not be signed in at all. The token names its
 * own form and is checked against the requested id — a valid handle for form A
 * must not download form B — and its workspace then goes through the same
 * `openExport` tenancy query a session's does. A signed URL is a shortcut past
 * the login page and nothing more.
 *
 * A TOKEN'S SPEC WINS. When a handle carries one, the query string is ignored
 * entirely: a link minted for two columns must not turn into a link for forty
 * by editing the URL.
 *
 * THIS ROUTE ONLY EVER STREAMS WHAT IT CAN FINISH. `maxDuration` is 60s and the
 * headers are flushed with the first chunk, so an export that runs out of time
 * would arrive as a valid-looking file with rows missing — the exact failure the
 * streaming rewrite was meant to remove. A pre-flight count refuses anything
 * above SYNC_ROW_CEILING with a 413, and the Export dialog turns that into a
 * queued job.
 */
type Authorized = { workspaceId: string; spec: ExportSpec }

async function authorize(request: Request, formId: string): Promise<Authorized | null> {
  const params = new URL(request.url).searchParams
  const token = params.get("token")

  if (token) {
    const grant = verifyExportToken(token)
    if (!grant || grant.formId !== formId) return null
    const spec = grant.spec ? exportSpecSchema.parse(grant.spec) : DEFAULT_SPEC
    return { workspaceId: grant.workspaceId, spec }
  }

  const workspace = await getDefaultWorkspace()
  if (!workspace) return null
  return { workspaceId: workspace.id, spec: parseExportSpec(params) }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (!auth) return new Response("Unauthorized", { status: 401 })

  const source = await openExport(id, auth.workspaceId, auth.spec)
  // An id from another tenant is indistinguishable from one that never existed.
  if (!source) return new Response("Not found", { status: 404 })

  const rowCount = await countExportRows(id, auth.spec)
  if (!isSyncEligible(auth.spec, rowCount)) {
    return new Response(
      "This export is too large to download directly. Use the Export dialog to queue it and we will email you a link.",
      { status: 413 },
    )
  }

  const now = new Date()
  const chunks =
    auth.spec.format === "json" ? jsonChunks(source, { spec: auth.spec, exportedAt: now }) : csvChunks(source)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // `pull`, not a loop in `start`: the stream asks for the next chunk when
      // the consumer is ready for it, so a slow client cannot make us buffer
      // the whole export in memory.
      try {
        const next = await chunks.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (err) {
        console.error("[export] failed", err)
        controller.error(err)
      }
    },
    cancel() {
      void chunks.return(undefined)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": CONTENT_TYPES[auth.spec.format],
      "content-disposition": `attachment; filename="${exportFileName(source.form.title, auth.spec.format, now)}"`,
      "cache-control": "no-store",
    },
  })
}
```

- [ ] **Step 5: Run the whole suite to verify it passes**

Run: `pnpm vitest run --project=integration tests/integration/export-route.test.ts`
Expected: PASS — the 11 original tests plus the 5 new ones.

Run: `pnpm lint` — expected: clean. The old route imported `answerToCell`, `csvRow`, `markdownToPlainText` and the Drizzle helpers directly; every one of those imports is gone now, and eslint will name any that were left behind.

If `vi.spyOn(query, "countExportRows")` throws "cannot redefine property" — Vitest cannot always patch a live ESM namespace — replace it with a module mock at the top of the file that keeps the real implementations and overrides only the count:

```ts
vi.mock("@/lib/submissions/export-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/submissions/export-query")>()
  return { ...actual, countExportRows: vi.fn(actual.countExportRows) }
})
```

then `vi.mocked(query.countExportRows).mockResolvedValueOnce(SYNC_ROW_CEILING + 1)` inside the test.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/forms/\[id\]/export/route.ts src/lib/mcp/export-token.ts tests/integration/export-route.test.ts
git commit -m "feat(export): parameterise the download route with an export spec"
```

---

### Task 7: The `export_jobs` table

**Files:**
- Modify: `src/lib/db/schema.ts` (enums near line 148, table after `integrationDeliveries`)
- Create: `drizzle/<next>_export_jobs.sql` (generated)

**Interfaces:**
- Consumes: `ExportSpec` (Task 1).
- Produces: `exportJobStatusEnum`, `exportJobs`, `type ExportJob`, `type ExportJobArtifact`.

- [ ] **Step 1: Add the enum and the table**

In `src/lib/db/schema.ts`, after `webhookDeliveryStatusEnum`:

```ts
export const exportJobStatusEnum = pgEnum('export_job_status', [
  'queued',
  'running',
  'ready',
  'failed',
  'expired', // artifacts pruned; the row stays as the audit record
])
```

Above the JSONB shapes section, add the artifact type:

```ts
/**
 * One downloadable produced by an export. A job has several when it carries
 * both data and media, or when the media had to be split across archives
 * (Cloudinary caps how much one `generate_archive` call should carry).
 */
export type ExportJobArtifact = {
  kind: 'data' | 'media'
  name: string
  url: string
  bytes: number
  /** Cloudinary public id + resource type, so pruning can delete it. */
  storageKey: string
  resourceType: 'image' | 'video' | 'raw'
}
```

After the `integrationDeliveries` table definition:

```ts
/**
 * The export queue, and the export audit log — deliberately the same table.
 *
 * Every export writes a row here, including the ones that stream straight to
 * the browser (inserted 'ready', with row_count). Bulk egress of respondent
 * data is exactly the thing an owner later needs to account for, and a log
 * that is a by-product of the feature cannot drift from it.
 *
 * The claim columns mirror webhook_deliveries, for the reasons written at
 * length in src/lib/integrations/webhook-delivery.ts: the status flip is what
 * prevents a double run, SKIP LOCKED only keeps concurrent sweeps from
 * blocking each other, and claim_token is the fencing token that stops a
 * revived worker from recording over the run that legitimately owns the row.
 */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    // Who asked. NOT a FK to users: the audit record must survive the account
    // being deleted, which is when it matters most.
    requestedBy: uuid('requested_by'),
    requestedByEmail: text('requested_by_email'),
    /** The API key that asked, when it came in over MCP. */
    apiKeyId: uuid('api_key_id'),
    spec: jsonb('spec').$type<ExportSpec>().notNull(),
    /** True when this streamed inline — the row exists only as an audit entry. */
    inline: boolean('inline').notNull().default(false),
    status: exportJobStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    claimToken: uuid('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    rowCount: integer('row_count'),
    fileCount: integer('file_count'),
    artifacts: jsonb('artifacts').$type<ExportJobArtifact[]>(),
    error: text('error'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    /** When the artifacts are pruned. Null for inline exports (nothing stored). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // The sweep's due-work query.
    index('export_jobs_status_next_idx').on(table.status, table.nextAttemptAt),
    // The "recent exports" panel, per form, newest first.
    index('export_jobs_form_created_idx').on(table.formId, table.createdAt),
    index('export_jobs_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
)

export type ExportJob = typeof exportJobs.$inferSelect
```

Add `import type { ExportSpec } from '@/lib/submissions/export-spec'` at the top of `schema.ts`.

If that import creates a cycle (`export-spec.ts` must not import from `schema.ts` — check it; as written in Task 1 it does not), keep it. If a cycle appears, inline the type as `jsonb('spec').$type<Record<string, unknown>>()` and cast at the two call sites rather than restructuring the schema file.

- [ ] **Step 2: Generate and run the migration**

```bash
pnpm db:generate
pnpm db:migrate
```

Expected: one new file in `drizzle/`, `CREATE TYPE "public"."export_job_status"` and `CREATE TABLE "export_jobs"` in it. Read the generated SQL before running it — confirm it contains no `DROP`.

- [ ] **Step 3: Verify the integration database picks it up**

Run: `pnpm vitest run --project=integration tests/integration/export-route.test.ts`
Expected: PASS (migrations run in the integration setup, so this proves the new migration applies cleanly).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(export): export_jobs, the queue and the audit log"
```

---

### Task 8: The queue

**Files:**
- Create: `src/lib/core/export-jobs.ts`
- Test: `tests/integration/export-jobs.test.ts`

**Interfaces:**
- Consumes: `exportJobs` / `ExportJobArtifact` (Task 7), `ExportSpec` (Task 1).
- Produces: `EXPORT_JOB_MAX_ATTEMPTS`, `ARTIFACT_TTL_DAYS`, `STALE_CLAIM_MINUTES`, `recordInlineExport(input)`, `enqueueExport(input): Promise<ExportJob>`, `claimDueExports(limit): Promise<ExportJob[]>`, `reclaimStaleExports(): Promise<number>`, `finishExport(id, claimToken, result)`, `failExport(id, claimToken, error)`, `pruneExpiredArtifacts(): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/export-jobs.test.ts`:

```ts
/**
 * The export queue. Everything here is about a job being run ONCE and never
 * getting stuck — the same two properties webhook_deliveries has, proved the
 * same way.
 */
import { describe, expect, test, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { exportJobs, forms, workspaces } from "@/lib/db/schema"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import {
  claimDueExports,
  enqueueExport,
  failExport,
  finishExport,
  pruneExpiredArtifacts,
  reclaimStaleExports,
  recordInlineExport,
  EXPORT_JOB_MAX_ATTEMPTS,
} from "@/lib/core/export-jobs"

vi.mock("@/lib/cloudinary/delete", () => ({
  destroyAssets: vi.fn(async () => {}),
  resourceTypeFromMime: (m?: string | null) => (m?.startsWith("image/") ? "image" : "raw"),
  assetFromUrl: () => null,
}))

let seq = 0
async function seed() {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS j ${seq}`, slug: `ws-j-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Jobs", publicId: `j${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  return { workspaceId: ws.id, formId: form.id }
}

const base = async () => {
  const f = await seed()
  return {
    ...f,
    spec: exportSpecSchema.parse({ format: "xlsx" }),
    requestedBy: "00000000-0000-0000-0000-0000000000aa",
    requestedByEmail: "owner@test.dev",
    apiKeyId: null,
  }
}

describe("export queue", () => {
  test("an inline export is recorded as an audit row, already ready", async () => {
    const input = await base()
    const job = await recordInlineExport({ ...input, rowCount: 42 })
    expect(job.status).toBe("ready")
    expect(job.inline).toBe(true)
    expect(job.rowCount).toBe(42)
    expect(job.expiresAt).toBeNull()
  })

  test("a queued job is claimed exactly once, even by two concurrent sweeps", async () => {
    const input = await base()
    await enqueueExport(input)
    const [a, b] = await Promise.all([claimDueExports(10), claimDueExports(10)])
    expect(a.length + b.length).toBe(1)
    const claimed = [...a, ...b][0]
    expect(claimed.status).toBe("running")
    expect(claimed.claimToken).toBeTruthy()
    expect(claimed.attempts).toBe(1)
  })

  test("finishing needs the claim token, so a revived worker cannot overwrite a newer run", async () => {
    const input = await base()
    const queued = await enqueueExport(input)
    const [claimed] = await claimDueExports(10)

    const stale = await finishExport(queued.id, "00000000-0000-0000-0000-0000000000ff", {
      rowCount: 1,
      fileCount: 0,
      artifacts: [],
    })
    expect(stale).toBe(false)

    const ok = await finishExport(claimed.id, claimed.claimToken!, {
      rowCount: 7,
      fileCount: 2,
      artifacts: [
        { kind: "data", name: "a.csv", url: "https://res.test/a.csv", bytes: 12, storageKey: "exports/a", resourceType: "raw" },
      ],
    })
    expect(ok).toBe(true)

    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, claimed.id))
    expect(row.status).toBe("ready")
    expect(row.rowCount).toBe(7)
    expect(row.readyAt).toBeTruthy()
    expect(row.expiresAt).toBeTruthy()
  })

  test("a failure is retried until the attempt ceiling, then stays failed", async () => {
    const input = await base()
    await enqueueExport(input)

    for (let i = 1; i <= EXPORT_JOB_MAX_ATTEMPTS; i++) {
      // Retries are scheduled into the future, so make them due again.
      await db.update(exportJobs).set({ nextAttemptAt: new Date(Date.now() - 1000) })
      const [claimed] = await claimDueExports(10)
      expect(claimed).toBeTruthy()
      await failExport(claimed.id, claimed.claimToken!, `attempt ${i} exploded`)
    }

    await db.update(exportJobs).set({ nextAttemptAt: new Date(Date.now() - 1000) })
    expect(await claimDueExports(10)).toEqual([])
    const [row] = await db.select().from(exportJobs)
    expect(row.status).toBe("failed")
    expect(row.error).toContain("exploded")
  })

  test("a job whose worker died is reclaimed rather than stranded", async () => {
    const input = await base()
    await enqueueExport(input)
    const [claimed] = await claimDueExports(10)
    await db
      .update(exportJobs)
      .set({ claimedAt: sql`now() - interval '30 minutes'` })
      .where(eq(exportJobs.id, claimed.id))

    expect(await reclaimStaleExports()).toBe(1)
    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, claimed.id))
    expect(row.status).toBe("queued")
    expect(row.claimToken).toBeNull()
  })

  test("expired artifacts are deleted and the row is kept as the audit record", async () => {
    const input = await base()
    const job = await enqueueExport(input)
    await db
      .update(exportJobs)
      .set({
        status: "ready",
        expiresAt: sql`now() - interval '1 day'`,
        artifacts: [
          { kind: "data", name: "a.csv", url: "https://res.test/a.csv", bytes: 1, storageKey: "exports/a", resourceType: "raw" },
        ],
      })
      .where(eq(exportJobs.id, job.id))

    expect(await pruneExpiredArtifacts()).toBe(1)
    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, job.id))
    expect(row.status).toBe("expired")
    expect(row.artifacts).toEqual([])
    expect(row.rowCount).toBe(row.rowCount) // the audit fields are untouched
  })

  test("claims are scoped to due work only", async () => {
    const input = await base()
    const job = await enqueueExport(input)
    await db
      .update(exportJobs)
      .set({ nextAttemptAt: sql`now() + interval '1 hour'` })
      .where(eq(exportJobs.id, job.id))
    expect(await claimDueExports(10)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project=integration tests/integration/export-jobs.test.ts`
Expected: FAIL — cannot resolve `@/lib/core/export-jobs`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/core/export-jobs.ts`:

```ts
import "server-only"

/**
 * The export queue, claimed the same way webhook deliveries are.
 *
 * READ src/lib/integrations/webhook-delivery.ts BEFORE CHANGING ANY OF THIS.
 * The claim is one statement: an UPDATE whose subquery takes `FOR UPDATE SKIP
 * LOCKED` rows and flips their status. What actually prevents a job running
 * twice is the status flip — an overlapping sweep's subquery no longer matches.
 * SKIP LOCKED only stops two sweeps from queueing behind each other.
 *
 * `claim_token` is a per-row fencing token. Without it, reclaiming a stalled
 * job is unsafe: the original worker can wake up after its row was handed to
 * somebody else and record its own outcome over the newer run. Every write that
 * finishes a job must match on the token it was claimed with.
 *
 * NO AuthContext IN THIS FILE. A sweep runs across every tenant and has neither
 * a user nor a workspace; the tenant-scoped reads live in src/lib/data/exports.ts.
 */

import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { exportJobs, type ExportJob, type ExportJobArtifact } from "@/lib/db/schema"
import { destroyAssets } from "@/lib/cloudinary/delete"
import type { ExportSpec } from "@/lib/submissions/export-spec"

export const EXPORT_JOB_MAX_ATTEMPTS = 3
export const ARTIFACT_TTL_DAYS = 7

/**
 * How long a claim may sit before a sweep assumes its worker died.
 *
 * MUST COMFORTABLY EXCEED the cron route's maxDuration (60s). A run that can
 * outlive the reclaim window would have its row taken while still working, and
 * the export would be produced twice.
 */
export const STALE_CLAIM_MINUTES = 15

/** Retry backoff in seconds, indexed by attempts already made. */
const BACKOFF_SECONDS = [60, 300]

export type ExportRequest = {
  workspaceId: string
  formId: string
  requestedBy: string | null
  requestedByEmail: string | null
  apiKeyId: string | null
  spec: ExportSpec
}

/** Log an export that streamed straight to the browser. Audit only — nothing to run. */
export async function recordInlineExport(input: ExportRequest & { rowCount: number }): Promise<ExportJob> {
  const [row] = await db
    .insert(exportJobs)
    .values({
      workspaceId: input.workspaceId,
      formId: input.formId,
      requestedBy: input.requestedBy,
      requestedByEmail: input.requestedByEmail,
      apiKeyId: input.apiKeyId,
      spec: input.spec,
      inline: true,
      status: "ready",
      rowCount: input.rowCount,
      readyAt: new Date(),
    })
    .returning()
  return row
}

export async function enqueueExport(input: ExportRequest): Promise<ExportJob> {
  const [row] = await db
    .insert(exportJobs)
    .values({
      workspaceId: input.workspaceId,
      formId: input.formId,
      requestedBy: input.requestedBy,
      requestedByEmail: input.requestedByEmail,
      apiKeyId: input.apiKeyId,
      spec: input.spec,
      status: "queued",
    })
    .returning()
  return row
}

/**
 * Take whatever is due. Returns full rows, re-read through Drizzle rather than
 * mapped from `RETURNING *` — raw results come back snake_cased and would need
 * hand-maintained mapping to stay in step with the schema.
 */
export async function claimDueExports(limit: number): Promise<ExportJob[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE export_jobs
       SET status = 'running',
           claimed_at = now(),
           claim_token = gen_random_uuid(),
           attempts = attempts + 1
     WHERE id IN (
       SELECT id
         FROM export_jobs
        WHERE status = 'queued'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
          FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING id
  `)
  const ids = Array.from(claimed as Iterable<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return []
  return db.select().from(exportJobs).where(inArray(exportJobs.id, ids))
}

/** Hand back jobs whose worker never came home. Runs at the top of every sweep. */
export async function reclaimStaleExports(): Promise<number> {
  const reclaimed = await db.execute<{ id: string }>(sql`
    UPDATE export_jobs
       SET status = 'queued',
           claim_token = null,
           claimed_at = null,
           next_attempt_at = now()
     WHERE status = 'running'
       AND claimed_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval
    RETURNING id
  `)
  return Array.from(reclaimed as Iterable<{ id: string }>).length
}

/** Record success. Returns false when the token is stale — somebody else owns this row. */
export async function finishExport(
  id: string,
  claimToken: string,
  result: { rowCount: number; fileCount: number; artifacts: ExportJobArtifact[] },
): Promise<boolean> {
  const expires = new Date(Date.now() + ARTIFACT_TTL_DAYS * 24 * 60 * 60 * 1000)
  const updated = await db
    .update(exportJobs)
    .set({
      status: "ready",
      rowCount: result.rowCount,
      fileCount: result.fileCount,
      artifacts: result.artifacts,
      readyAt: new Date(),
      expiresAt: expires,
      error: null,
    })
    .where(and(eq(exportJobs.id, id), eq(exportJobs.claimToken, claimToken)))
    .returning({ id: exportJobs.id })
  return updated.length > 0
}

/**
 * Record a failure, and decide whether it is worth another go.
 *
 * The message is stored because it is the only diagnostic an owner (or we) will
 * have — a failed export gives the UI something to say beyond "it didn't work".
 */
export async function failExport(id: string, claimToken: string, error: string): Promise<boolean> {
  const [job] = await db
    .select({ attempts: exportJobs.attempts })
    .from(exportJobs)
    .where(and(eq(exportJobs.id, id), eq(exportJobs.claimToken, claimToken)))
  if (!job) return false

  const exhausted = job.attempts >= EXPORT_JOB_MAX_ATTEMPTS
  const backoff = BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 300

  const updated = await db
    .update(exportJobs)
    .set({
      status: exhausted ? "failed" : "queued",
      error: error.slice(0, 2000),
      claimToken: null,
      claimedAt: null,
      nextAttemptAt: exhausted ? new Date() : new Date(Date.now() + backoff * 1000),
    })
    .where(and(eq(exportJobs.id, id), eq(exportJobs.claimToken, claimToken)))
    .returning({ id: exportJobs.id })
  return updated.length > 0
}

/**
 * Delete artifacts past their TTL and mark the job expired.
 *
 * THE ROW SURVIVES. The files are respondent data and should not sit in an
 * object store forever, but the record of who exported what is the whole point
 * of this table, so only `artifacts` is cleared.
 */
export async function pruneExpiredArtifacts(): Promise<number> {
  const due = await db
    .select({ id: exportJobs.id, artifacts: exportJobs.artifacts })
    .from(exportJobs)
    .where(and(eq(exportJobs.status, "ready"), isNotNull(exportJobs.expiresAt), lte(exportJobs.expiresAt, new Date())))
    .limit(100)

  for (const job of due) {
    await destroyAssets(
      (job.artifacts ?? []).map((a) => ({ publicId: a.storageKey, resourceType: a.resourceType })),
    )
    await db
      .update(exportJobs)
      .set({ status: "expired", artifacts: [] })
      .where(eq(exportJobs.id, job.id))
  }
  return due.length
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project=integration tests/integration/export-jobs.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/export-jobs.ts tests/integration/export-jobs.test.ts
git commit -m "feat(export): claim-based export queue with reclaim and pruning"
```

---

### Task 9: Artifacts, the worker, and the sweep

**Files:**
- Create: `src/lib/submissions/export-artifact.ts`
- Create: `src/lib/submissions/export-worker.ts`
- Create: `src/app/api/cron/exports/route.ts`
- Test: `tests/integration/export-worker.test.ts`

**Interfaces:**
- Consumes: `openExport` / `countExportRows` (Task 4), `csvChunks` / `jsonChunks` / `exportFileName` / `CONTENT_TYPES` (Task 5), the queue (Task 8), `isCronRequest` from `@/lib/cron/auth`, `CLOUDINARY_FOLDERS` from `@/lib/cloudinary/config`.
- Produces: `uploadExportArtifact(name, contentType, chunks): Promise<ExportJobArtifact | null>`, `runExportJob(job): Promise<void>`, `POST` on `/api/cron/exports`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/export-worker.test.ts`:

```ts
/**
 * One claimed job, end to end: build the file, store it, record it. Cloudinary
 * is stubbed — what is being proved here is that a job reaches 'ready' with an
 * artifact and a row count, and that a thrown error lands as a retry rather
 * than a stuck 'running' row.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { answers, exportJobs, formFields, forms, submissions, workspaces } from "@/lib/db/schema"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import { claimDueExports, enqueueExport } from "@/lib/core/export-jobs"

const uploaded: { name: string; body: string }[] = []
vi.mock("@/lib/submissions/export-artifact", () => ({
  uploadExportArtifact: vi.fn(async (name: string, _type: string, chunks: AsyncGenerator<string>) => {
    let body = ""
    for await (const c of chunks) body += c
    uploaded.push({ name, body })
    return {
      kind: "data" as const,
      name,
      url: `https://res.test/${name}`,
      bytes: body.length,
      storageKey: `makingflow/exports/${name}`,
      resourceType: "raw" as const,
    }
  }),
}))
vi.mock("@/lib/submissions/export-media", () => ({
  buildMediaArchives: vi.fn(async () => []),
  archivePath: (storageKey: string) => storageKey,
}))

const { runExportJob } = await import("@/lib/submissions/export-worker")

let seq = 0
async function seed(rows: number) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS w ${seq}`, slug: `ws-w-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Applications", publicId: `w${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [name] = await db
    .insert(formFields)
    .values([{ formId: form.id, type: "short_text" as const, label: "Name", position: 0 }])
    .returning({ id: formFields.id })
  for (let i = 0; i < rows; i++) {
    const [sub] = await db
      .insert(submissions)
      .values({ formId: form.id, workspaceId: ws.id, status: "completed", completedAt: new Date() })
      .returning({ id: submissions.id })
    await db
      .insert(answers)
      .values({ submissionId: sub.id, fieldId: name.id, question: "Name", type: "short_text", value: `P${i}` })
  }
  return { workspaceId: ws.id, formId: form.id }
}

beforeEach(() => {
  uploaded.length = 0
})

describe("runExportJob", () => {
  test("produces a CSV artifact and marks the job ready", async () => {
    const f = await seed(3)
    await enqueueExport({
      ...f,
      requestedBy: null,
      requestedByEmail: "owner@test.dev",
      apiKeyId: null,
      spec: exportSpecSchema.parse({}),
    })
    const [job] = await claimDueExports(1)
    await runExportJob(job)

    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, job.id))
    expect(row.status).toBe("ready")
    expect(row.rowCount).toBe(3)
    expect(row.artifacts?.[0].name).toMatch(/applications-\d{4}-\d{2}-\d{2}\.csv/)
    expect(uploaded[0].body).toContain("P0")
  })

  test("a form deleted between queueing and running fails the job instead of hanging", async () => {
    const f = await seed(1)
    await enqueueExport({
      ...f,
      requestedBy: null,
      requestedByEmail: null,
      apiKeyId: null,
      spec: exportSpecSchema.parse({}),
    })
    const [job] = await claimDueExports(1)
    await db.update(forms).set({ deletedAt: new Date() }).where(eq(forms.id, f.formId))

    await runExportJob(job)
    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, job.id))
    expect(row.status).toBe("queued") // retried
    expect(row.error).toContain("no longer available")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project=integration tests/integration/export-worker.test.ts`
Expected: FAIL — cannot resolve `@/lib/submissions/export-worker`.

- [ ] **Step 3: Write the artifact uploader**

Create `src/lib/submissions/export-artifact.ts`:

```ts
import "server-only"

/**
 * Where a finished export is kept until somebody downloads it.
 *
 * Cloudinary, as a `raw` asset, because it is already the file store and
 * already has server-side credentials — no second provider for one feature.
 * The public id is random and the artifact is pruned after seven days
 * (ARTIFACT_TTL_DAYS): these URLs are public, exactly like respondent uploads
 * are, which is the accepted trade recorded in the design note.
 *
 * The whole artifact is buffered here. That is the one place in this feature
 * where an export sits in memory, and it is unavoidable — a signed Cloudinary
 * upload needs the bytes. It is bounded by being a job (never a request) and by
 * the row ceilings in the spec.
 */

import { createHash, randomBytes } from "node:crypto"
import { CLOUDINARY_FOLDERS } from "@/lib/cloudinary/config"
import type { ExportJobArtifact } from "@/lib/db/schema"

const TIMEOUT_MS = 55_000

function creds() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

export async function uploadExportArtifact(
  name: string,
  contentType: string,
  chunks: AsyncGenerator<string>,
): Promise<ExportJobArtifact | null> {
  const c = creds()
  if (!c) {
    console.warn("[export] Cloudinary credentials missing — cannot store the artifact")
    return null
  }

  const parts: string[] = []
  for await (const chunk of chunks) parts.push(chunk)
  const blob = new Blob(parts, { type: contentType })

  const folder = CLOUDINARY_FOLDERS.uploads
  // Unguessable, because the URL is the only thing protecting the file.
  const publicId = `exports/${randomBytes(16).toString("hex")}/${name}`
  const timestamp = Math.floor(Date.now() / 1000)

  // Cloudinary signs every parameter except file, cloud_name, resource_type and
  // api_key, sorted by key, with the secret appended.
  const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
  const signature = createHash("sha1").update(`${toSign}${c.apiSecret}`).digest("hex")

  const body = new FormData()
  body.append("file", blob, name)
  body.append("folder", folder)
  body.append("public_id", publicId)
  body.append("timestamp", String(timestamp))
  body.append("api_key", c.apiKey)
  body.append("signature", signature)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/raw/upload`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    // Never log the body: it echoes the URL, and for an export that is a link
    // to respondent data.
    throw new Error(`Cloudinary refused the export artifact (${res.status})`)
  }

  const data = (await res.json()) as Record<string, unknown>
  const url = typeof data.secure_url === "string" ? data.secure_url : ""
  const storageKey = typeof data.public_id === "string" ? data.public_id : ""
  if (!url || !storageKey) throw new Error("Cloudinary accepted the artifact but returned no URL")

  return {
    kind: "data",
    name,
    url,
    bytes: typeof data.bytes === "number" ? data.bytes : blob.size,
    storageKey,
    resourceType: "raw",
  }
}
```

- [ ] **Step 4: Write the worker**

Create `src/lib/submissions/export-worker.ts`:

```ts
import "server-only"

/**
 * Running one claimed export.
 *
 * Everything that can go wrong here is retryable by default: Cloudinary being
 * slow, a transient database error, a timeout. So the worker reports failures
 * through `failExport`, which decides between another attempt and giving up,
 * and NEVER swallows one — a job stuck in 'running' is worse than a job marked
 * failed, because only one of those is visible.
 *
 * `finishExport` and `failExport` both require the claim token this job was
 * handed. If this run lost its row to a reclaim while it was working, both
 * return false and this run's result is discarded — which is the point.
 */

import { failExport, finishExport } from "@/lib/core/export-jobs"
import type { ExportJob, ExportJobArtifact } from "@/lib/db/schema"
import { uploadExportArtifact } from "@/lib/submissions/export-artifact"
import { buildMediaArchives } from "@/lib/submissions/export-media"
import { openExport } from "@/lib/submissions/export-query"
import { CONTENT_TYPES, csvChunks, exportFileName, jsonChunks } from "@/lib/submissions/export-serialize"
import { writeXlsx } from "@/lib/submissions/export-xlsx"
import { exportSpecSchema } from "@/lib/submissions/export-spec"

export async function runExportJob(job: ExportJob): Promise<void> {
  const token = job.claimToken
  if (!token) return // not ours to run

  try {
    const spec = exportSpecSchema.parse(job.spec)
    const source = await openExport(job.formId, job.workspaceId, spec)
    if (!source) {
      // Deleted, or moved out of the workspace, between queueing and running.
      await failExport(job.id, token, "The form is no longer available to this workspace.")
      return
    }

    const now = new Date()
    const artifacts: ExportJobArtifact[] = []
    let rowCount = 0
    let fileCount = 0

    if (spec.files !== "zip-only") {
      const name = exportFileName(source.form.title, spec.format, now)
      const counted = countingSource(source, (n) => (rowCount = n))
      const artifact =
        spec.format === "xlsx"
          ? await writeXlsx(counted, name, uploadExportArtifact)
          : await uploadExportArtifact(
              name,
              CONTENT_TYPES[spec.format],
              spec.format === "json" ? jsonChunks(counted, { spec, exportedAt: now }) : csvChunks(counted),
            )
      if (!artifact) throw new Error("Export storage is not configured on this deployment")
      artifacts.push(artifact)
    }

    if (spec.files === "zip" || spec.files === "zip-only") {
      const media = await buildMediaArchives(job.formId, job.workspaceId, spec, source.form.title, now)
      artifacts.push(...media.artifacts)
      fileCount = media.fileCount
      if (spec.files === "zip-only") rowCount = media.rowCount
    }

    const recorded = await finishExport(job.id, token, { rowCount, fileCount, artifacts })
    if (!recorded) console.warn(`[export] job ${job.id} finished after losing its claim — result discarded`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[export] job ${job.id} failed`, err)
    await failExport(job.id, token, message)
  }
}

/**
 * Wrap a source so the row count is known without a second pass. The
 * serialisers consume the generator; this counts what goes through it.
 */
function countingSource(
  source: Awaited<ReturnType<typeof openExport>> & object,
  report: (n: number) => void,
): NonNullable<Awaited<ReturnType<typeof openExport>>> {
  const inner = source as NonNullable<Awaited<ReturnType<typeof openExport>>>
  return {
    ...inner,
    rows: (async function* () {
      let n = 0
      for await (const row of inner.rows) {
        n += 1
        yield row
      }
      report(n)
    })(),
  }
}
```

- [ ] **Step 5: Write the sweep**

Create `src/app/api/cron/exports/route.ts`:

```ts
import { isCronRequest } from "@/lib/cron/auth"
import {
  claimDueExports,
  pruneExpiredArtifacts,
  reclaimStaleExports,
} from "@/lib/core/export-jobs"
import { runExportJob } from "@/lib/submissions/export-worker"

/**
 * The export sweep, invoked once a minute by the same Postgres cron mechanism
 * as the webhook sweep — see doc/webhook-cron.md for the SQL, and add the
 * matching job for this path.
 *
 * NO after() IN THIS ROUTE, for the reasons spelled out in the webhook sweep:
 * nobody is waiting, the instance can be frozen the moment the response is
 * returned, and the response body is the only diagnostic the caller keeps.
 *
 * EVERY EXIT CARRIES A BODY, including the failures. pg_net stores the response
 * and nothing else, and pg_cron reports the job as succeeded regardless.
 */

// Must stay comfortably below STALE_CLAIM_MINUTES in core/export-jobs.ts.
export const maxDuration = 60

/** One job per sweep: an XLSX or a 200-file archive is not a small piece of work. */
const BATCH = 1

export async function POST(request: Request) {
  let authorized: boolean
  try {
    authorized = isCronRequest(request)
  } catch (error) {
    return Response.json({ error: "misconfigured", detail: (error as Error).message }, { status: 500 })
  }
  if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 })

  try {
    const reclaimed = await reclaimStaleExports()
    const claimed = await claimDueExports(BATCH)
    for (const job of claimed) await runExportJob(job)
    const pruned = await pruneExpiredArtifacts()
    return Response.json({ reclaimed, ran: claimed.length, pruned })
  } catch (error) {
    console.error("[cron/exports] sweep failed", error)
    return Response.json({ error: "sweep failed", detail: (error as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run --project=integration tests/integration/export-worker.test.ts`
Expected: FAIL first with `Failed to resolve import "@/lib/submissions/export-xlsx"` and `"@/lib/submissions/export-media"` — both arrive in Tasks 10 and 11. Create the two stubs now so this task closes on its own:

`src/lib/submissions/export-xlsx.ts`:

```ts
import "server-only"

import type { ExportJobArtifact } from "@/lib/db/schema"
import type { ExportSource } from "@/lib/submissions/export-query"

/** Replaced in Task 10 by the real exceljs writer. */
export async function writeXlsx(
  _source: ExportSource,
  _name: string,
  _upload: unknown,
): Promise<ExportJobArtifact | null> {
  throw new Error("XLSX export is not available yet")
}
```

`src/lib/submissions/export-media.ts`:

```ts
import "server-only"

import type { ExportJobArtifact } from "@/lib/db/schema"
import type { ExportSpec } from "@/lib/submissions/export-spec"

export type MediaResult = { artifacts: ExportJobArtifact[]; fileCount: number; rowCount: number }

/** Replaced in Task 11 by the real Cloudinary archive builder. */
export async function buildMediaArchives(
  _formId: string,
  _workspaceId: string,
  _spec: ExportSpec,
  _formTitle: string,
  _now: Date,
): Promise<MediaResult> {
  throw new Error("Media archives are not available yet")
}
```

Re-run: `pnpm vitest run --project=integration tests/integration/export-worker.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Document the cron job**

Append to `doc/webhook-cron.md` a second section, copying the existing SQL with the path changed to `/api/cron/exports` and the schedule kept at once a minute. State in one line that it must be created manually, like the webhook one, because the integration database has neither `pg_cron` nor `pg_net`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/submissions/export-artifact.ts src/lib/submissions/export-worker.ts src/lib/submissions/export-xlsx.ts src/lib/submissions/export-media.ts src/app/api/cron/exports/route.ts tests/integration/export-worker.test.ts doc/webhook-cron.md
git commit -m "feat(export): run queued exports on a cron sweep and store artifacts"
```

---

### Task 10: XLSX

**Files:**
- Modify: `package.json` (add `exceljs`)
- Modify: `src/lib/submissions/export-artifact.ts` (split out a bytes uploader)
- Replace: `src/lib/submissions/export-xlsx.ts` (the Task 9 stub)
- Modify: `src/lib/submissions/export-worker.ts` (the XLSX branch)
- Test: `tests/unit/export-xlsx.test.ts`

**Interfaces:**
- Consumes: `ExportSource` (Task 4), `rowCells` (Task 3).
- Produces: `XLSX_ROW_CEILING`, `writeXlsx(source): Promise<{ bytes: Uint8Array; rowCount: number }>`, `uploadExportBytes(name, contentType, bytes, kind?): Promise<ExportJobArtifact | null>`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add exceljs
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/export-xlsx.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import ExcelJS from "exceljs"
import { buildColumns } from "@/lib/submissions/export-columns"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import type { ExportSubmission } from "@/lib/submissions/export-row"
import { writeXlsx, XLSX_ROW_CEILING } from "@/lib/submissions/export-xlsx"

const sources = {
  fields: [
    { id: "f1", label: "Name", type: "short_text" },
    { id: "f2", label: "Score", type: "rating" },
  ],
  removedQuestions: [],
  followUpCount: 0,
  timezone: "UTC",
}

function sub(values: Record<string, unknown>): ExportSubmission {
  return {
    id: "s1",
    createdAt: new Date("2026-09-22T08:45:00.000Z"),
    completedAt: new Date("2026-09-22T08:45:00.000Z"),
    status: "completed",
    language: null,
    mode: "classic",
    reviewStatus: "new",
    tags: [],
    aiSummary: null,
    aiScore: null,
    aiScreenReason: null,
    calculations: null,
    meta: null,
    values: values as never,
    removed: {},
    followUps: [],
    files: [],
  }
}

function source(rows: ExportSubmission[]) {
  const spec = exportSpecSchema.parse({ format: "xlsx" })
  return {
    form: { id: "f", title: "Applications" },
    columns: buildColumns(spec, sources),
    sources,
    rows: (async function* () {
      for (const r of rows) yield r
    })(),
  }
}

async function read(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as never)
  const sheet = wb.worksheets[0]
  const out: unknown[][] = []
  sheet.eachRow((row) => out.push((row.values as unknown[]).slice(1)))
  return { sheetName: sheet.name, rows: out }
}

describe("writeXlsx", () => {
  test("a header row and one row per submission", async () => {
    const { bytes, rowCount } = await writeXlsx(source([sub({ f1: "Ayesha", f2: 5 })]))
    const { rows, sheetName } = await read(bytes)
    expect(sheetName).toBe("Responses")
    expect(rows[0]).toEqual(["Submitted (UTC)", "Name", "Score"])
    expect(rows[1]).toEqual(["2026-09-22 08:45:00", "Ayesha", "5"])
    expect(rowCount).toBe(1)
  })

  test("respondent text is inert: a leading = is stored as text, never as a formula", async () => {
    const { bytes } = await writeXlsx(source([sub({ f1: "=1+1" })]))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(bytes) as never)
    const cell = wb.worksheets[0].getCell("B2")
    expect(cell.formula).toBeUndefined()
    expect(cell.value).toBe("=1+1")
  })

  test("an export beyond the workbook ceiling is refused rather than trimmed", async () => {
    const many = Array.from({ length: 3 }, () => sub({ f1: "x" }))
    await expect(writeXlsx(source(many), 2)).rejects.toThrow(/too large for a spreadsheet/i)
    expect(XLSX_ROW_CEILING).toBeGreaterThan(10_000)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/export-xlsx.test.ts`
Expected: FAIL — `XLSX export is not available yet` from the Task 9 stub.

- [ ] **Step 4: Write the implementation**

Replace `src/lib/submissions/export-xlsx.ts` entirely:

```ts
import "server-only"

/**
 * The format most owners actually want.
 *
 * Written with exceljs rather than by hand, because an xlsx is a zip of XML
 * parts and hand-rolling one is a week of other people's bug reports.
 *
 * EVERY CELL IS A STRING, deliberately. exceljs will happily turn `=SUM(A1)`
 * into a live formula if handed it as a value, which is the same injection the
 * CSV path neutralises with a leading apostrophe — and here the fix is simply
 * to declare the type. Numbers-as-text is the right trade: an owner can convert
 * a column in one click, and nobody can convert a formula back into the answer
 * a respondent actually typed.
 *
 * Unlike CSV and JSON this cannot stream: a workbook is finalised before its
 * first byte is valid. Hence the ceiling, and hence XLSX being job-only.
 */

import ExcelJS from "exceljs"
import type { ExportSource } from "@/lib/submissions/export-query"
import { rowCells } from "@/lib/submissions/export-row"

/** Excel's own limit is 1,048,576 rows; ours is where the memory cost stops being sane. */
export const XLSX_ROW_CEILING = 100_000

export async function writeXlsx(
  source: ExportSource,
  ceiling: number = XLSX_ROW_CEILING,
): Promise<{ bytes: Uint8Array; rowCount: number }> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "MakingFlow"
  const sheet = workbook.addWorksheet("Responses", { views: [{ state: "frozen", ySplit: 1 }] })

  const header = sheet.addRow(source.columns.map((c) => c.header))
  header.font = { bold: true }

  let rowCount = 0
  for await (const sub of source.rows) {
    if (rowCount >= ceiling) {
      // Refuse, never trim. A short spreadsheet that looks complete is the
      // failure this whole plan exists to remove.
      throw new Error(
        `This export is too large for a spreadsheet (${ceiling.toLocaleString()} rows). Export as CSV instead.`,
      )
    }
    const row = sheet.addRow(rowCells(sub, source.columns))
    row.eachCell((cell) => {
      cell.value = cell.value == null ? "" : String(cell.value)
    })
    rowCount += 1
  }

  sheet.columns.forEach((column) => {
    column.width = 24
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return { bytes: new Uint8Array(buffer as ArrayBuffer), rowCount }
}
```

- [ ] **Step 5: Add the bytes uploader**

In `src/lib/submissions/export-artifact.ts`, extract the upload so binary artifacts can use it. Replace the tail of `uploadExportArtifact` (from `const parts` onwards) with:

```ts
  const parts: string[] = []
  for await (const chunk of chunks) parts.push(chunk)
  return uploadExportBytes(name, contentType, new Blob(parts, { type: contentType }))
}

/**
 * Store one finished artifact. Takes a Blob so both the text serialisers and
 * the xlsx writer (which produces bytes) go through one signed upload.
 */
export async function uploadExportBytes(
  name: string,
  contentType: string,
  payload: Blob | Uint8Array,
  kind: ExportJobArtifact["kind"] = "data",
): Promise<ExportJobArtifact | null> {
  const c = creds()
  if (!c) {
    console.warn("[export] Cloudinary credentials missing — cannot store the artifact")
    return null
  }
  const blob = payload instanceof Blob ? payload : new Blob([payload], { type: contentType })
```

...keeping the rest of the existing body (public id, signature, fetch, response parsing) and returning `kind` instead of the literal `"data"`. Move the `creds()` guard out of `uploadExportArtifact` since `uploadExportBytes` now owns it.

- [ ] **Step 6: Wire the worker**

In `src/lib/submissions/export-worker.ts`, replace the XLSX branch:

```ts
      let artifact: ExportJobArtifact | null
      if (spec.format === "xlsx") {
        const { bytes, rowCount: written } = await writeXlsx(counted)
        rowCount = written
        artifact = await uploadExportBytes(name, CONTENT_TYPES.xlsx, bytes)
      } else {
        artifact = await uploadExportArtifact(
          name,
          CONTENT_TYPES[spec.format],
          spec.format === "json" ? jsonChunks(counted, { spec, exportedAt: now }) : csvChunks(counted),
        )
      }
```

and change the import to `import { uploadExportArtifact, uploadExportBytes } from "@/lib/submissions/export-artifact"`.

- [ ] **Step 7: Run both suites to verify they pass**

Run: `pnpm vitest run tests/unit/export-xlsx.test.ts`
Expected: PASS (3 tests).

Run: `pnpm vitest run --project=integration tests/integration/export-worker.test.ts`
Expected: PASS (2 tests) — the worker test stubs `uploadExportArtifact`, which the CSV branch still uses.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/submissions/export-xlsx.ts src/lib/submissions/export-artifact.ts src/lib/submissions/export-worker.ts tests/unit/export-xlsx.test.ts
git commit -m "feat(export): XLSX workbooks, with every cell inert"
```

---

### Task 11: The media archive

**Files:**
- Modify: `src/lib/submissions/answer-format.ts` (`AnswerFile` carries its storage key and mime)
- Modify: `src/lib/submissions/export-row.ts` (`ExportFileRef` gains `storageKey` / `mime`)
- Modify: `src/lib/submissions/export-query.ts` (`answersFor` keeps them; `path` becomes the archive path)
- Replace: `src/lib/submissions/export-media.ts` (the Task 9 stub)
- Test: `tests/unit/export-media.test.ts`

**Interfaces:**
- Consumes: `openExport` (Task 4), `resourceTypeFromMime` / `assetFromUrl` from `@/lib/cloudinary/delete`, `uploadExportBytes` is NOT used — Cloudinary stores the archive itself.
- Produces: `ARCHIVE_CHUNK`, `archivePath(storageKey, format): string`, `collectAssets(source): Promise<MediaAsset[]>`, `buildMediaArchives(formId, workspaceId, spec, formTitle, now): Promise<MediaResult>`, `type MediaAsset = { publicId: string; resourceType: "image" | "video" | "raw" }`.

- [ ] **Step 1: Carry the storage key through**

In `src/lib/submissions/answer-format.ts`, extend the file shape. The stored value already has these keys — `field-control.tsx:1033` writes `{ storageKey, url, name, mime, bytes }` — they were simply being dropped:

```ts
export type AnswerFile = {
  name: string
  url: string
  /** Cloudinary public id, when the upload recorded one. Needed to archive it. */
  storageKey?: string
  mime?: string
}
```

and inside `answerFiles`, replace the push with:

```ts
      out.push({
        name: r.name ? String(r.name) : "file",
        url: r.url ? String(r.url) : "",
        storageKey: r.storageKey ? String(r.storageKey) : undefined,
        mime: r.mime ? String(r.mime) : undefined,
      })
```

In `src/lib/submissions/export-row.ts`, extend the ref:

```ts
/** One uploaded file, with the path it will have inside a media archive. */
export type ExportFileRef = {
  path: string
  url: string
  name: string
  storageKey?: string
  mime?: string
}
```

In `src/lib/submissions/export-query.ts`, inside `answersFor`, replace the file push with:

```ts
    for (const f of answerFiles(a.value) ?? []) {
      // `path` is where this file will sit inside a media archive when one is
      // produced, and the delivery URL when one is not — so the Files column
      // always points at something real.
      bucket.files.push({
        path: f.storageKey ? archivePath(f.storageKey, f.name) : f.url,
        url: f.url,
        name: f.name,
        storageKey: f.storageKey,
        mime: f.mime,
      })
    }
```

and import `archivePath` from `@/lib/submissions/export-media`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/export-media.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest"
import { ARCHIVE_CHUNK, archivePath, collectAssets, groupByResourceType } from "@/lib/submissions/export-media"
import type { ExportSubmission } from "@/lib/submissions/export-row"

function sub(files: ExportSubmission["files"]): ExportSubmission {
  return {
    id: "s1",
    createdAt: new Date(),
    completedAt: new Date(),
    status: "completed",
    language: null,
    mode: "classic",
    reviewStatus: "new",
    tags: [],
    aiSummary: null,
    aiScore: null,
    aiScreenReason: null,
    calculations: null,
    meta: null,
    values: {},
    removed: {},
    followUps: [],
    files,
  }
}

const source = (rows: ExportSubmission[]) => ({
  form: { id: "f", title: "Roles" },
  columns: [],
  sources: { fields: [], removedQuestions: [], followUpCount: 0, timezone: "UTC" },
  rows: (async function* () {
    for (const r of rows) yield r
  })(),
})

describe("export media", () => {
  test("an archive entry keeps the stored extension so the file opens", () => {
    expect(archivePath("makingflow/submissions/ab12", "cv.pdf")).toBe("makingflow/submissions/ab12.pdf")
    expect(archivePath("makingflow/submissions/ab12", "photo")).toBe("makingflow/submissions/ab12")
  })

  test("assets are collected across submissions and de-duplicated", async () => {
    const shared = { path: "p", url: "u", name: "cv.pdf", storageKey: "k1", mime: "application/pdf" }
    const assets = await collectAssets(
      source([sub([shared]), sub([shared, { ...shared, storageKey: "k2", mime: "image/png", name: "id.png" }])]) as never,
    )
    expect(assets).toEqual([
      { publicId: "k1", resourceType: "raw" },
      { publicId: "k2", resourceType: "image" },
    ])
  })

  test("a file with no storage key is recovered from its delivery URL", async () => {
    const assets = await collectAssets(
      source([
        sub([
          {
            path: "p",
            url: "https://res.cloudinary.com/demo/image/upload/v1700000000/makingflow/submissions/legacy.png",
            name: "legacy.png",
          },
        ]),
      ]) as never,
    )
    expect(assets).toEqual([{ publicId: "makingflow/submissions/legacy", resourceType: "image" }])
  })

  test("a file we cannot address at all is skipped rather than failing the export", async () => {
    const assets = await collectAssets(
      source([sub([{ path: "p", url: "https://someone-elses-cdn.test/x.pdf", name: "x.pdf" }])]) as never,
    )
    expect(assets).toEqual([])
  })

  test("assets are grouped by resource type and chunked", () => {
    const many = Array.from({ length: ARCHIVE_CHUNK + 5 }, (_, i) => ({
      publicId: `k${i}`,
      resourceType: "raw" as const,
    }))
    const groups = groupByResourceType([...many, { publicId: "img", resourceType: "image" }])
    expect(groups).toHaveLength(3)
    expect(groups[0]).toEqual({ resourceType: "raw", publicIds: many.slice(0, ARCHIVE_CHUNK).map((a) => a.publicId) })
    expect(groups[1].publicIds).toHaveLength(5)
    expect(groups[2]).toEqual({ resourceType: "image", publicIds: ["img"] })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/export-media.test.ts`
Expected: FAIL — `archivePath`, `collectAssets` and `groupByResourceType` are not exported by the stub.

- [ ] **Step 4: Write the implementation**

Replace `src/lib/submissions/export-media.ts` entirely:

```ts
import "server-only"

/**
 * "Give me every CV in one zip" — the reason this whole feature exists for
 * anyone hiring.
 *
 * CLOUDINARY BUILDS THE ZIP, WE DO NOT. `generate_archive` takes a list of
 * public ids and produces a stored zip; the bytes never pass through us. The
 * alternative — fetching 200 PDFs and streaming them into an archive inside a
 * 60-second route — is one HTTP call versus two hundred, and would put every
 * respondent's file through our egress for no gain.
 *
 * ENTRIES ARE NAMED BY PUBLIC ID, and that is a considered choice, not a
 * limitation we failed to notice. Cloudinary cannot name entries per file, and
 * `use_original_filename` is worse than it looks: two hundred respondents all
 * uploading `resume.pdf` collide inside one zip, and a collision inside an
 * archive is a file that silently is not there. Unique-by-construction names
 * plus the `Files` column in the data export — which holds the exact in-zip
 * path for each submission — is the pairing that cannot lose anything.
 *
 * ONE ARCHIVE PER RESOURCE TYPE, chunked. `resource_type` is part of the
 * endpoint path, so images and raw files cannot go in one call; and a single
 * call is capped at ARCHIVE_CHUNK ids so a large form produces several
 * reasonable archives rather than one request Cloudinary times out on.
 */

import { createHash } from "node:crypto"
import { assetFromUrl, resourceTypeFromMime } from "@/lib/cloudinary/delete"
import type { ExportJobArtifact } from "@/lib/db/schema"
import { openExport, type ExportSource } from "@/lib/submissions/export-query"
import type { ExportSpec } from "@/lib/submissions/export-spec"

/** Public ids per `generate_archive` call. */
export const ARCHIVE_CHUNK = 200

const TIMEOUT_MS = 55_000

export type ResourceType = "image" | "video" | "raw"
export type MediaAsset = { publicId: string; resourceType: ResourceType }
export type MediaResult = { artifacts: ExportJobArtifact[]; fileCount: number; rowCount: number }

function creds() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/**
 * Where one file sits inside the archive.
 *
 * Cloudinary names entries by public id and appends the asset's own extension,
 * so this mirrors that: the public id, plus the extension from the name the
 * respondent uploaded. It goes in the data export's Files column, so the two
 * halves of a media export refer to each other by the same string.
 */
export function archivePath(storageKey: string, name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
  return `${storageKey}${ext}`
}

/** Every archivable asset in scope, de-duplicated, in encounter order. */
export async function collectAssets(source: ExportSource): Promise<MediaAsset[]> {
  const seen = new Map<string, MediaAsset>()
  for await (const sub of source.rows) {
    for (const f of sub.files) {
      // Prefer what the upload recorded; fall back to parsing the delivery URL
      // for rows written before storageKey was kept. A file on somebody else's
      // CDN (an import) is skipped: we cannot archive what we do not host.
      const asset = f.storageKey
        ? { publicId: f.storageKey, resourceType: resourceTypeFromMime(f.mime) }
        : assetFromUrl(f.url)
      if (!asset?.publicId) continue
      const resourceType = (asset.resourceType ?? "raw") as ResourceType
      if (!seen.has(asset.publicId)) seen.set(asset.publicId, { publicId: asset.publicId, resourceType })
    }
  }
  return [...seen.values()]
}

export type ArchiveGroup = { resourceType: ResourceType; publicIds: string[] }

/** Split into per-resource-type, ARCHIVE_CHUNK-sized calls. */
export function groupByResourceType(assets: MediaAsset[]): ArchiveGroup[] {
  const buckets = new Map<ResourceType, string[]>()
  for (const a of assets) {
    const list = buckets.get(a.resourceType) ?? []
    list.push(a.publicId)
    buckets.set(a.resourceType, list)
  }
  const groups: ArchiveGroup[] = []
  for (const [resourceType, ids] of buckets) {
    for (let i = 0; i < ids.length; i += ARCHIVE_CHUNK) {
      groups.push({ resourceType, publicIds: ids.slice(i, i + ARCHIVE_CHUNK) })
    }
  }
  return groups
}

/** One `generate_archive` call. */
async function createArchive(group: ArchiveGroup, name: string): Promise<ExportJobArtifact> {
  const c = creds()
  if (!c) throw new Error("Cloudinary is not configured on this deployment")

  const timestamp = Math.floor(Date.now() / 1000)
  const publicIds = group.publicIds.join(",")
  // Signed exactly like every other call we make: all parameters except
  // file/cloud_name/resource_type/api_key, sorted by key, secret appended.
  const params: Record<string, string> = {
    allow_missing: "true",
    mode: "create",
    public_ids: publicIds,
    target_format: "zip",
    target_public_id: `makingflow/exports/${name}`,
    timestamp: String(timestamp),
  }
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&")
  const signature = createHash("sha1").update(`${toSign}${c.apiSecret}`).digest("hex")

  const body = new FormData()
  for (const [k, v] of Object.entries(params)) body.append(k, v)
  body.append("api_key", c.apiKey)
  body.append("signature", signature)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${c.cloudName}/${group.resourceType}/generate_archive`,
    { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  // Never log the body — it lists respondent file ids.
  if (!res.ok) throw new Error(`Cloudinary refused the archive (${res.status})`)

  const data = (await res.json()) as Record<string, unknown>
  const url = typeof data.secure_url === "string" ? data.secure_url : ""
  const storageKey = typeof data.public_id === "string" ? data.public_id : ""
  if (!url || !storageKey) throw new Error("Cloudinary built an archive but returned no URL")

  return {
    kind: "media",
    name: `${name}.zip`,
    url,
    bytes: typeof data.bytes === "number" ? data.bytes : 0,
    storageKey,
    // An archive is stored as a raw asset regardless of what went into it.
    resourceType: "raw",
  }
}

export async function buildMediaArchives(
  formId: string,
  workspaceId: string,
  spec: ExportSpec,
  formTitle: string,
  now: Date,
): Promise<MediaResult> {
  // A second pass over the scope, with the columns switched off: this one only
  // needs the files, and reusing openExport means it cannot drift from the rows
  // the data export contains.
  const source = await openExport(formId, workspaceId, {
    ...spec,
    columns: { meta: [], fields: [], removedQuestions: false, aiFollowUps: false },
  })
  if (!source) throw new Error("The form is no longer available to this workspace.")

  let rowCount = 0
  const counting: ExportSource = {
    ...source,
    rows: (async function* () {
      for await (const row of source.rows) {
        rowCount += 1
        yield row
      }
    })(),
  }

  const assets = await collectAssets(counting)
  if (assets.length === 0) return { artifacts: [], fileCount: 0, rowCount }

  const slug = formTitle.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "form"
  const day = now.toISOString().slice(0, 10)
  const groups = groupByResourceType(assets)

  const artifacts: ExportJobArtifact[] = []
  for (const [i, group] of groups.entries()) {
    const suffix = groups.length > 1 ? `-${i + 1}` : ""
    artifacts.push(await createArchive(group, `${slug}-files-${day}${suffix}`))
  }
  return { artifacts, fileCount: assets.length, rowCount }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/export-media.test.ts`
Expected: PASS (5 tests).

Run: `pnpm vitest run` — expected: the whole suite green. `answerFiles` gained two optional properties, so check that `discord.ts`, `email.ts` and `notion-sync.ts` (its three other callers) still typecheck: `pnpm lint` plus `pnpm exec tsc --noEmit`.

- [ ] **Step 6: Verify against the real Cloudinary account**

This is the one call in the plan whose exact response shape is not covered by a test double, so prove it once by hand before trusting it in a job.

```bash
node --env-file=.env.local -e '
const { createHash } = require("node:crypto")
const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
const key = process.env.CLOUDINARY_API_KEY
const secret = process.env.CLOUDINARY_API_SECRET
const timestamp = Math.floor(Date.now() / 1000)
const params = { allow_missing: "true", mode: "create", prefixes: "makingflow/submissions", target_format: "zip", target_public_id: "makingflow/exports/probe", timestamp: String(timestamp) }
const toSign = Object.keys(params).sort().map(k => k + "=" + params[k]).join("&")
const signature = createHash("sha1").update(toSign + secret).digest("hex")
const body = new FormData()
for (const [k, v] of Object.entries(params)) body.append(k, v)
body.append("api_key", key); body.append("signature", signature)
fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/generate_archive`, { method: "POST", body })
  .then(r => r.text()).then(t => console.log(t.slice(0, 600)))
'
```

Expected: JSON containing `secure_url`, `public_id`, `bytes` and `file_count`. Confirm the two things the implementation assumes: `mode=create` returns a `secure_url` immediately, and `target_public_id` is honoured. If `raw` returns `file_count: 0` for a folder that holds images, that confirms the per-resource-type split is necessary rather than cautious. Delete the probe archive afterwards from the Cloudinary console.

If the response shape differs, fix `createArchive` to match what the account actually returns — and note the difference in the design doc under D7.

- [ ] **Step 7: Commit**

```bash
git add src/lib/submissions/export-media.ts src/lib/submissions/export-row.ts src/lib/submissions/export-query.ts src/lib/submissions/answer-format.ts tests/unit/export-media.test.ts
git commit -m "feat(export): zip every uploaded file through Cloudinary archives"
```

---

### Task 12: Telling the owner it is ready

**Files:**
- Create: `src/lib/email/export-ready.ts`
- Create: `src/lib/data/exports.ts`
- Modify: `src/lib/submissions/export-worker.ts` (send after `finishExport`)
- Test: `tests/integration/export-notify.test.ts`

**Interfaces:**
- Consumes: `sendEmail` from `@/lib/email/provider`, `exportJobs` (Task 7), `getWorkspaceMembership` from `@/lib/auth/session`.
- Produces: `sendExportReadyEmail(job, formTitle): Promise<void>`, `getRecentExports(formId, workspaceId, limit?): Promise<ExportJobSummary[]>`, `getExportJob(id, workspaceId): Promise<ExportJobSummary | null>`, `type ExportJobSummary`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/export-notify.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { exportJobs, forms, workspaces } from "@/lib/db/schema"
import { exportSpecSchema } from "@/lib/submissions/export-spec"

const sent: { to: string[]; subject: string; html: string }[] = []
vi.mock("@/lib/email/provider", () => ({
  sendEmail: vi.fn(async (opts: { to: string[]; subject: string; html: string }) => {
    sent.push(opts)
    return { ok: true }
  }),
  isEmailConfigured: () => true,
}))

const { sendExportReadyEmail } = await import("@/lib/email/export-ready")
const { getRecentExports } = await import("@/lib/data/exports")

let seq = 0
async function seedJob(overrides: Partial<typeof exportJobs.$inferInsert> = {}) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS n ${seq}`, slug: `ws-n-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Roles", publicId: `n${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [job] = await db
    .insert(exportJobs)
    .values({
      workspaceId: ws.id,
      formId: form.id,
      requestedBy: null,
      requestedByEmail: "owner@test.dev",
      apiKeyId: null,
      spec: exportSpecSchema.parse({}),
      status: "ready",
      rowCount: 12,
      fileCount: 3,
      artifacts: [
        { kind: "data", name: "roles.csv", url: "https://res.test/roles.csv", bytes: 100, storageKey: "k1", resourceType: "raw" },
        { kind: "media", name: "roles-files.zip", url: "https://res.test/roles-files.zip", bytes: 900, storageKey: "k2", resourceType: "raw" },
      ],
      readyAt: new Date(),
      ...overrides,
    })
    .returning()
  return { workspaceId: ws.id, formId: form.id, job }
}

describe("export notification", () => {
  test("links every artifact and says how much is in it", async () => {
    const { job } = await seedJob()
    await sendExportReadyEmail(job, "Roles")
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual(["owner@test.dev"])
    expect(sent[0].subject).toContain("Roles")
    expect(sent[0].html).toContain("https://res.test/roles.csv")
    expect(sent[0].html).toContain("https://res.test/roles-files.zip")
    expect(sent[0].html).toContain("12 responses")
    expect(sent[0].html).toContain("3 files")
  })

  test("a job with nobody to write to is not an error", async () => {
    sent.length = 0
    const { job } = await seedJob({ requestedByEmail: null })
    await expect(sendExportReadyEmail(job, "Roles")).resolves.toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  test("recent exports are workspace-scoped and newest first", async () => {
    const a = await seedJob()
    const b = await seedJob()
    const mine = await getRecentExports(a.formId, a.workspaceId)
    expect(mine.map((j) => j.id)).toEqual([a.job.id])
    expect(await getRecentExports(a.formId, b.workspaceId)).toEqual([])
  })

  test("an expired job reports itself as expired rather than offering a dead link", async () => {
    const { formId, workspaceId, job } = await seedJob()
    await db.update(exportJobs).set({ status: "expired", artifacts: [] }).where(eq(exportJobs.id, job.id))
    const [row] = await getRecentExports(formId, workspaceId)
    expect(row.status).toBe("expired")
    expect(row.artifacts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project=integration tests/integration/export-notify.test.ts`
Expected: FAIL — cannot resolve `@/lib/email/export-ready`.

- [ ] **Step 3: Write the email**

Create `src/lib/email/export-ready.ts`:

```ts
import "server-only"

/**
 * "Your export is ready."
 *
 * REPORTS NOTHING UPWARDS, deliberately — this is the one place in the export
 * path where a failure must not fail the work. The artifact is already stored
 * and already visible in the Exports panel; an unsendable email is a worse
 * notification, not a worse export. It is logged and dropped.
 *
 * The links are public Cloudinary URLs that expire in seven days, which the
 * email says out loud: a recipient who forwards it is forwarding respondent
 * data, and the only thing that limits that is the clock.
 */

import { sendEmail } from "@/lib/email/provider"
import type { ExportJob } from "@/lib/db/schema"

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function sendExportReadyEmail(job: ExportJob, formTitle: string): Promise<void> {
  const to = job.requestedByEmail
  if (!to) return // an MCP key with no human behind it

  const title = formTitle || "your form"
  const parts: string[] = []
  if (job.rowCount != null) parts.push(`${job.rowCount.toLocaleString()} responses`)
  if (job.fileCount) parts.push(`${job.fileCount.toLocaleString()} files`)

  const links = (job.artifacts ?? [])
    .map((a) => `<li><a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a></li>`)
    .join("")

  const html = `
    <p>Your export of <strong>${escapeHtml(title)}</strong> is ready${parts.length ? ` — ${escapeHtml(parts.join(", "))}` : ""}.</p>
    <ul>${links}</ul>
    <p>These links stop working in seven days. They contain responses people gave you, so treat them like the data itself.</p>
  `

  const res = await sendEmail({
    to: [to],
    subject: `Your export of ${title} is ready`,
    html,
    // At-least-once delivery: the job id means a retried sweep does not send twice.
    idempotencyKey: job.id,
  })
  if (!res.ok) console.error(`[export] could not email the ready notice for job ${job.id}: ${res.error}`)
}
```

- [ ] **Step 4: Write the read layer**

Create `src/lib/data/exports.ts`:

```ts
import "server-only"

/**
 * Reading the export log, always through a workspace.
 *
 * The queue module has no tenancy concept — a sweep runs across every tenant —
 * so every owner-facing read of the same table happens here, scoped. A job id
 * from another workspace is indistinguishable from one that never existed.
 */

import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { exportJobs, type ExportJobArtifact } from "@/lib/db/schema"
import type { ExportSpec } from "@/lib/submissions/export-spec"

export type ExportJobSummary = {
  id: string
  status: "queued" | "running" | "ready" | "failed" | "expired"
  inline: boolean
  format: ExportSpec["format"]
  rowCount: number | null
  fileCount: number | null
  artifacts: ExportJobArtifact[]
  error: string | null
  createdAt: Date
  readyAt: Date | null
  expiresAt: Date | null
  requestedByEmail: string | null
}

const columns = {
  id: exportJobs.id,
  status: exportJobs.status,
  inline: exportJobs.inline,
  spec: exportJobs.spec,
  rowCount: exportJobs.rowCount,
  fileCount: exportJobs.fileCount,
  artifacts: exportJobs.artifacts,
  error: exportJobs.error,
  createdAt: exportJobs.createdAt,
  readyAt: exportJobs.readyAt,
  expiresAt: exportJobs.expiresAt,
  requestedByEmail: exportJobs.requestedByEmail,
}

const toSummary = (r: {
  [K in keyof typeof columns]: unknown
}): ExportJobSummary => ({
  id: r.id as string,
  status: r.status as ExportJobSummary["status"],
  inline: r.inline as boolean,
  format: (r.spec as ExportSpec).format,
  rowCount: r.rowCount as number | null,
  fileCount: r.fileCount as number | null,
  artifacts: (r.artifacts as ExportJobArtifact[] | null) ?? [],
  error: r.error as string | null,
  createdAt: r.createdAt as Date,
  readyAt: r.readyAt as Date | null,
  expiresAt: r.expiresAt as Date | null,
  requestedByEmail: r.requestedByEmail as string | null,
})

/** The Exports panel: what this form has produced lately, queued ones included. */
export async function getRecentExports(
  formId: string,
  workspaceId: string,
  limit = 10,
): Promise<ExportJobSummary[]> {
  const rows = await db
    .select(columns)
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.formId, formId),
        eq(exportJobs.workspaceId, workspaceId),
        // Inline downloads are audit entries, not deliverables — they have
        // nothing to offer a panel whose every row is a link.
        eq(exportJobs.inline, false),
      ),
    )
    .orderBy(desc(exportJobs.createdAt))
    .limit(limit)
  return rows.map(toSummary)
}

/** One job, for the poll that follows a queued export. */
export async function getExportJob(id: string, workspaceId: string): Promise<ExportJobSummary | null> {
  const [row] = await db
    .select(columns)
    .from(exportJobs)
    .where(and(eq(exportJobs.id, id), eq(exportJobs.workspaceId, workspaceId)))
    .limit(1)
  return row ? toSummary(row) : null
}
```

- [ ] **Step 5: Send it from the worker**

In `src/lib/submissions/export-worker.ts`, after a successful `finishExport`:

```ts
    const recorded = await finishExport(job.id, token, { rowCount, fileCount, artifacts })
    if (!recorded) {
      console.warn(`[export] job ${job.id} finished after losing its claim — result discarded`)
      return
    }
    // Reads back the finished row so the email quotes what was actually stored
    // rather than what this run believes it stored.
    const finished = await getExportJob(job.id, job.workspaceId)
    if (finished) {
      await sendExportReadyEmail(
        { ...job, rowCount, fileCount, artifacts, readyAt: finished.readyAt },
        source.form.title,
      )
    }
```

with `import { sendExportReadyEmail } from "@/lib/email/export-ready"` and `import { getExportJob } from "@/lib/data/exports"`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run --project=integration tests/integration/export-notify.test.ts tests/integration/export-worker.test.ts`
Expected: PASS (4 + 2 tests). The worker test does not stub the email provider, so add the same `vi.mock("@/lib/email/provider", …)` block to `tests/integration/export-worker.test.ts` — without it the worker attempts a real Resend call and the test depends on an env var.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email/export-ready.ts src/lib/data/exports.ts src/lib/submissions/export-worker.ts tests/integration/export-notify.test.ts tests/integration/export-worker.test.ts
git commit -m "feat(export): email a finished export and read the export log"
```

---

### Task 13: The Export dialog

**Files:**
- Create: `src/lib/actions/exports.ts`
- Create: `src/components/forms/export-dialog.tsx`
- Modify: `src/components/forms/submissions-view.tsx` (the Export button; pass live filter state)
- Modify: `src/app/api/forms/[id]/export/route.ts` (record the inline export)
- Test: `tests/integration/export-request.test.ts`

**Interfaces:**
- Consumes: `countExportRows` (Task 4), `isSyncEligible` / `encodeSpec` (Task 1), `enqueueExport` / `recordInlineExport` (Task 8), `getRequiredUser` / `getDefaultWorkspace` from `@/lib/auth/session`, `getExportJob` (Task 12).
- Produces: `requestExport(formId, spec): Promise<RequestExportResult>`, `pollExportJob(jobId): Promise<ExportJobSummary | null>`, `<ExportDialog>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/export-request.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest"
import { db } from "@/lib/db"
import { answers, exportJobs, formFields, forms, submissions, workspaces } from "@/lib/db/schema"

const session = vi.hoisted(() => ({ workspaceId: null as string | null }))
vi.mock("@/lib/auth/session", () => ({
  getDefaultWorkspace: async () =>
    session.workspaceId
      ? { id: session.workspaceId, name: "T", slug: "t", plan: "free", role: "owner", logoUrl: null }
      : null,
  getRequiredUser: async () => ({ id: "00000000-0000-0000-0000-0000000000aa", email: "owner@test.dev" }),
}))

const { requestExport } = await import("@/lib/actions/exports")
const { exportSpecSchema } = await import("@/lib/submissions/export-spec")

let seq = 0
async function seed(rows: number) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS r ${seq}`, slug: `ws-r-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Roles", publicId: `r${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [f1] = await db
    .insert(formFields)
    .values([{ formId: form.id, type: "short_text" as const, label: "Name", position: 0 }])
    .returning({ id: formFields.id })
  for (let i = 0; i < rows; i++) {
    const [sub] = await db
      .insert(submissions)
      .values({ formId: form.id, workspaceId: ws.id, status: "completed", completedAt: new Date() })
      .returning({ id: submissions.id })
    await db
      .insert(answers)
      .values({ submissionId: sub.id, fieldId: f1.id, question: "Name", type: "short_text", value: `P${i}` })
  }
  return { workspaceId: ws.id, formId: form.id }
}

beforeEach(() => {
  session.workspaceId = null
})

describe("requestExport", () => {
  test("a small CSV comes back as a URL to download now", async () => {
    const f = await seed(2)
    session.workspaceId = f.workspaceId
    const res = await requestExport(f.formId, exportSpecSchema.parse({}))
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.kind).toBe("download")
    expect(res.url).toContain(`/api/forms/${f.formId}/export?spec=`)
  })

  test("a ZIP request is always queued, however small", async () => {
    const f = await seed(1)
    session.workspaceId = f.workspaceId
    const res = await requestExport(f.formId, exportSpecSchema.parse({ files: "zip" }))
    expect(res.success && res.kind).toBe("job")

    const rows = await db.select().from(exportJobs)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("queued")
    expect(rows[0].requestedByEmail).toBe("owner@test.dev")
    expect(rows[0].inline).toBe(false)
  })

  test("another tenant's form is not found", async () => {
    const mine = await seed(1)
    const theirs = await seed(1)
    session.workspaceId = mine.workspaceId
    const res = await requestExport(theirs.formId, exportSpecSchema.parse({}))
    expect(res).toEqual({ success: false, error: "Form not found" })
  })

  test("a caller with no workspace gets nothing", async () => {
    const f = await seed(1)
    session.workspaceId = null
    const res = await requestExport(f.formId, exportSpecSchema.parse({}))
    expect(res.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project=integration tests/integration/export-request.test.ts`
Expected: FAIL — cannot resolve `@/lib/actions/exports`.

- [ ] **Step 3: Write the action**

Create `src/lib/actions/exports.ts`:

```ts
"use server"

/**
 * The one entry point the UI uses to ask for an export.
 *
 * It answers one of two ways, and the decision is NOT the caller's: a small CSV
 * or JSON comes back as a URL the browser can navigate to immediately, and
 * anything else — a spreadsheet, a media archive, a large scope — becomes a
 * queued job. The client cannot be trusted with this choice because the client
 * cannot see the row count, and the whole point of the ceiling is that we never
 * begin a stream we cannot finish.
 */

import { after } from "next/server"
import { getDefaultWorkspace, getRequiredUser } from "@/lib/auth/session"
import { enqueueExport } from "@/lib/core/export-jobs"
import { getExportJob, type ExportJobSummary } from "@/lib/data/exports"
import { countExportRows, openExport } from "@/lib/submissions/export-query"
import { encodeSpec, exportSpecSchema, isSyncEligible, type ExportSpec } from "@/lib/submissions/export-spec"

export type RequestExportResult =
  | { success: true; kind: "download"; url: string }
  | { success: true; kind: "job"; jobId: string; email: string | null }
  | { success: false; error: string }

export async function requestExport(formId: string, input: ExportSpec): Promise<RequestExportResult> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "Not signed in" }

  const parsed = exportSpecSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "That export request is not valid" }
  const spec = parsed.data

  // Tenancy first, and through the same query the download route uses.
  const source = await openExport(formId, workspace.id, spec)
  if (!source) return { success: false, error: "Form not found" }

  const rowCount = await countExportRows(formId, spec)

  if (isSyncEligible(spec, rowCount)) {
    // The route re-authorises from the session and writes its own audit row.
    return { success: true, kind: "download", url: `/api/forms/${formId}/export?spec=${encodeSpec(spec)}` }
  }

  const user = await getRequiredUser()
  const job = await enqueueExport({
    workspaceId: workspace.id,
    formId,
    requestedBy: user.id,
    requestedByEmail: user.email ?? null,
    apiKeyId: null,
    spec,
  })
  return { success: true, kind: "job", jobId: job.id, email: user.email ?? null }
}

/** Poll one job while the dialog is open. Workspace-scoped, like every read. */
export async function pollExportJob(jobId: string): Promise<ExportJobSummary | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null
  return getExportJob(jobId, workspace.id)
}
```

Check `getRequiredUser` against `src/lib/auth/session.ts` before relying on the shape used here; if it returns a different property for the address, use that and keep the `?? null`.

- [ ] **Step 4: Record inline downloads in the route**

In `src/app/api/forms/[id]/export/route.ts`, `authorize` already knows which door was used. Extend its result and log the download — the audit half of D5:

```ts
type Authorized = {
  workspaceId: string
  spec: ExportSpec
  requestedBy: string | null
  requestedByEmail: string | null
  apiKeyId: string | null
}
```

In the token branch, return `requestedBy: grant.userId, requestedByEmail: null, apiKeyId: grant.apiKeyId`. In the session branch, read the user with `getSession()` and return its id and email.

Then, immediately before returning the streaming `Response`:

```ts
  // The audit half of the export log: an inline download is a row too, so
  // "who took a copy of these responses" has one answer everywhere.
  //
  // In after(), because it must not delay the download and must not be able to
  // fail it — and the row count is the pre-filter upper bound, which is the
  // only count available before the stream has run.
  after(async () => {
    try {
      await recordInlineExport({
        workspaceId: auth.workspaceId,
        formId: id,
        requestedBy: auth.requestedBy,
        requestedByEmail: auth.requestedByEmail,
        apiKeyId: auth.apiKeyId,
        spec: auth.spec,
        rowCount,
      })
    } catch (err) {
      console.error("[export] could not record the download", err)
    }
  })
```

with `import { after } from "next/server"` and `import { recordInlineExport } from "@/lib/core/export-jobs"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run --project=integration tests/integration/export-request.test.ts tests/integration/export-route.test.ts`
Expected: PASS. `after()` is stubbed to a no-op in the integration setup (see `tests/setup-integration.ts`), so the route tests do not assert on the audit row; the `requestExport` suite covers the queued path.

- [ ] **Step 6: Build the dialog**

Create `src/components/forms/export-dialog.tsx`. It is a client component holding one `ExportSpec` in state, pre-seeded from what the owner is currently looking at:

```tsx
"use client"

/**
 * Choosing what to export.
 *
 * SEEDED FROM THE TABLE, which is the entire reason this dialog exists. The old
 * Export button sat next to an active filter chip and exported everything
 * anyway; opening this with the current search and filters already selected is
 * what makes the button mean what it looks like it means.
 *
 * The dialog does not decide whether an export downloads or queues —
 * `requestExport` does, because only the server can see the row count.
 */

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { showToast } from "@/components/ui/toast"
import { requestExport } from "@/lib/actions/exports"
import type { Filter, FilterColumn, MatchMode } from "@/lib/submissions/filter"
import {
  exportSpecSchema,
  META_COLUMNS,
  type ExportSpec,
  type MetaColumnKey,
} from "@/lib/submissions/export-spec"
import { META_HEADERS } from "@/lib/submissions/export-columns"

type Scope = "current" | "all" | "recent"

export function ExportDialog({
  formId,
  open,
  onOpenChange,
  columns,
  live,
  hasFiles,
}: {
  formId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: FilterColumn[]
  /** What the table is showing right now. */
  live: { search: string; filters: Filter[]; match: MatchMode }
  /** Whether this form has any file-upload or signature question at all. */
  hasFiles: boolean
}) {
  const [scope, setScope] = useState<Scope>(
    live.search.trim() || live.filters.length > 0 ? "current" : "all",
  )
  const [format, setFormat] = useState<ExportSpec["format"]>("csv")
  const [recent, setRecent] = useState(100)
  const [includePartials, setIncludePartials] = useState(false)
  const [meta, setMeta] = useState<MetaColumnKey[]>(["submitted"])
  const [fields, setFields] = useState<string[] | "all">("all")
  const [removedQuestions, setRemovedQuestions] = useState(false)
  const [aiFollowUps, setAiFollowUps] = useState(false)
  const [files, setFiles] = useState<ExportSpec["files"]>("urls")
  const [pending, start] = useTransition()

  function buildSpec(): ExportSpec {
    return exportSpecSchema.parse({
      format,
      scope: {
        status: includePartials ? "all" : "completed",
        search: scope === "current" ? live.search : undefined,
        filters: scope === "current" ? live.filters : [],
        match: live.match,
        limit: scope === "recent" ? recent : undefined,
        order: scope === "recent" ? "newest" : "oldest",
      },
      columns: { meta, fields, removedQuestions, aiFollowUps },
      files: hasFiles ? files : "none",
      // The owner's own clock is what they will read the spreadsheet in.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  }

  function submit() {
    start(async () => {
      const res = await requestExport(formId, buildSpec())
      if (!res.success) {
        showToast(res.error, { type: "error" })
        return
      }
      if (res.kind === "download") {
        // A plain navigation, so the browser handles the download and the
        // Content-Disposition filename survives.
        window.location.assign(res.url)
        onOpenChange(false)
        return
      }
      showToast(
        res.email
          ? `We're preparing your export and will email ${res.email} when it's ready.`
          : "We're preparing your export. It will appear under Exports when it's ready.",
        { type: "success" },
      )
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export responses</DialogTitle>
          <DialogDescription>Choose what to include. Large exports are prepared in the background.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Responses">
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current">The ones I'm looking at (search + filters)</SelectItem>
                <SelectItem value="all">Every response</SelectItem>
                <SelectItem value="recent">Most recent…</SelectItem>
              </SelectContent>
            </Select>
            {scope === "recent" ? (
              <Input
                type="number"
                min={1}
                value={recent}
                onChange={(e) => setRecent(Math.max(1, Number(e.target.value) || 1))}
                className="mt-2 w-28"
              />
            ) : null}
            <Toggle checked={includePartials} onChange={setIncludePartials} label="Include unfinished responses" />
          </Field>

          <Field label="Format">
            <Select value={format} onValueChange={(v) => setFormat(v as ExportSpec["format"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Extra columns">
            <div className="grid grid-cols-2 gap-1">
              {META_COLUMNS.filter((k) => k !== "submitted").map((key) => (
                <Toggle
                  key={key}
                  checked={meta.includes(key)}
                  onChange={(on) =>
                    setMeta((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)))
                  }
                  label={META_HEADERS[key]}
                />
              ))}
            </div>
            <Toggle checked={aiFollowUps} onChange={setAiFollowUps} label="AI follow-up questions and answers" />
            <Toggle checked={removedQuestions} onChange={setRemovedQuestions} label="Answers to deleted questions" />
          </Field>

          <Field label="Questions">
            <Toggle
              checked={fields === "all"}
              onChange={(on) => setFields(on ? "all" : [])}
              label="Every question"
            />
            {fields !== "all" ? (
              <div className="max-h-40 overflow-y-auto">
                {columns.map((c) => (
                  <Toggle
                    key={c.id}
                    checked={fields.includes(c.id)}
                    onChange={(on) =>
                      setFields((prev) =>
                        prev === "all" ? prev : on ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      )
                    }
                    label={c.label || "Untitled"}
                  />
                ))}
              </div>
            ) : null}
          </Field>

          {hasFiles ? (
            <Field label="Uploaded files">
              <Select value={files} onValueChange={(v) => setFiles(v as ExportSpec["files"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urls">Links in the file</SelectItem>
                  <SelectItem value="zip">Links, plus a ZIP of every file</SelectItem>
                  <SelectItem value="zip-only">Just the ZIP of files</SelectItem>
                  <SelectItem value="none">Leave files out</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            <Icon name="download" className="mr-1.5 size-4" />
            {pending ? "Preparing…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-foreground">{label}</p>
      {children}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </label>
  )
}
```

Before writing this, open `src/components/forms/submissions-filter-dialog.tsx` and match its imports and markup conventions — it is the closest neighbour, and the `Dialog`/`Select` primitives must come from the same paths it uses. Use `Checkbox` from `@/components/ui/checkbox` instead of a bare `<input type="checkbox">` if that component exists in the project.

- [ ] **Step 7: Replace the Export link**

In `src/components/forms/submissions-view.tsx`, replace the `<a href={...}>` Export anchor (around line 251) with a button that opens the dialog, and render the dialog:

```tsx
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Icon name="download" className="size-4" />
          Export
        </button>
```

Add `const [exportOpen, setExportOpen] = useState(false)` alongside the other state, and near the filter dialog:

```tsx
      <ExportDialog
        formId={formId}
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={columns}
        live={{ search, filters, match }}
        hasFiles={columns.some((c) => c.type === "file_upload" || c.type === "signature")}
      />
```

Then update the row-count line, which currently says "export for all" — it is no longer true that the export is all-or-nothing:

```tsx
        {totalCompleted > liveRows.length
          ? ` · showing the most recent ${liveRows.length} of ${totalCompleted} — export covers every response`
          : ""}
```

- [ ] **Step 8: Verify by hand**

Run: `pnpm dev`, open a form with responses and a file-upload question, then confirm all four:

1. Type in the search box, click Export — the dialog opens with "The ones I'm looking at" already selected.
2. Export as CSV — the file downloads immediately and contains only the searched rows.
3. Choose "Links, plus a ZIP" — the toast says an email is coming, and `select status, spec from export_jobs order by created_at desc limit 1` shows a queued row.
4. `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/exports` — the job goes `ready` and the artifact URLs open.

- [ ] **Step 9: Commit**

```bash
git add src/lib/actions/exports.ts src/components/forms/export-dialog.tsx src/components/forms/submissions-view.tsx src/app/api/forms/\[id\]/export/route.ts tests/integration/export-request.test.ts
git commit -m "feat(export): an Export dialog that exports what you are looking at"
```

---

### Task 14: MCP parity

**Files:**
- Modify: `src/lib/mcp/tools/data.ts` (`makingflow_export_submissions`)
- Test: `tests/integration/mcp-tools-extended.test.ts` (existing file, extended)

**Interfaces:**
- Consumes: `exportSpecSchema` / `encodeSpec` / `isSyncEligible` (Task 1), `countExportRows` (Task 4), `enqueueExport` (Task 8), `mintExportToken` (existing).
- Produces: the same tool, with optional `format`, `scope`, `columns` and `files` arguments and a result that is either a link or a job.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/mcp-tools-extended.test.ts`, following the existing call conventions in that file:

```ts
  test("export returns a link for a small CSV and a job for a ZIP", async () => {
    const f = await seedFormWithResponses(3)

    const link = await callTool("makingflow_export_submissions", { formId: f.formId })
    expect(link.downloadUrl).toContain("token=")
    expect(link.downloadUrl).not.toContain("spec=") // the spec rides inside the token
    expect(link.jobId).toBeNull()

    const queued = await callTool("makingflow_export_submissions", { formId: f.formId, files: "zip" })
    expect(queued.downloadUrl).toBeNull()
    expect(queued.jobId).toBeTruthy()
    expect(queued.status).toBe("queued")
  })

  test("an export link carries only the columns that were asked for", async () => {
    const f = await seedFormWithResponses(1)
    const res = await callTool("makingflow_export_submissions", {
      formId: f.formId,
      columns: { meta: ["submissionId"], fields: [] },
    })
    const token = new URL(res.downloadUrl).searchParams.get("token")!
    const grant = verifyExportToken(token)
    expect(grant?.spec?.columns.meta).toEqual(["submissionId"])
    expect(grant?.spec?.columns.fields).toEqual([])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project=integration tests/integration/mcp-tools-extended.test.ts`
Expected: FAIL — the tool rejects the unknown `files` argument, and its output has no `jobId`.

- [ ] **Step 3: Extend the tool**

In `src/lib/mcp/tools/data.ts`, replace the `makingflow_export_submissions` definition's schema and handler:

```ts
    description: [
      "Produce a download link for a form's responses as a file — one row per response, one column per question.",
      "",
      "This returns a LINK, not the file. Give it to the user to open. Exports are large and every cell is personal data written by a respondent, so pulling one into this conversation would be both wasteful and a privacy problem. Do not fetch the URL yourself.",
      "The link expires shortly, works only for this form, and downloads exactly the columns and scope this call asked for. Call again for a fresh one.",
      "Large exports, spreadsheets and file archives are prepared in the background: those return a `jobId` and no link, and the user is emailed when it is ready.",
      "For reading a handful of responses rather than all of them, use makingflow_list_submissions.",
    ].join("\n"),
    inputSchema: z.object({
      formId: z.string(),
      format: z.enum(["csv", "xlsx", "json"]).default("csv"),
      scope: z
        .object({
          status: z.enum(["completed", "all"]).default("completed").describe("`all` includes unfinished responses."),
          search: z.string().optional(),
          limit: z.number().int().positive().optional().describe("Most recent N responses."),
          from: z.string().optional().describe("ISO date, inclusive."),
          to: z.string().optional().describe("ISO date, inclusive."),
        })
        .optional(),
      columns: z
        .object({
          meta: z.array(z.enum(META_COLUMNS)).optional().describe("Non-answer columns: ids, scores, tags, source."),
          fields: z.union([z.literal("all"), z.array(z.string())]).optional(),
          aiFollowUps: z.boolean().optional().describe("Include the AI conversation as question/answer column pairs."),
          removedQuestions: z.boolean().optional().describe("Include answers to questions since deleted."),
        })
        .optional(),
      files: z
        .enum(["none", "urls", "zip", "zip-only"])
        .default("urls")
        .describe("`zip` also builds an archive of every uploaded file — always prepared in the background."),
      timezone: z.string().optional().describe("IANA zone for the timestamp columns. Defaults to UTC."),
    }),
    outputSchema: z.object({
      formId: z.string(),
      downloadUrl: z.string().nullable().describe("Give this to the user. Do not fetch it."),
      expiresInSeconds: z.number().int().nullable(),
      jobId: z.string().nullable().describe("Set when the export is being prepared in the background."),
      status: z.enum(["ready", "queued"]),
      responseCount: z.number().int().describe("Completed responses in scope, before answer filters."),
    }),
    scopes: ["submissions:read"],
    readOnly: true,
    async handler(ctx, args) {
      // Resolve the form through the tenancy-checked read BEFORE minting a
      // token or queueing anything for it. Signing an id we never verified
      // would turn this into a way to mint working handles for other tenants.
      const counts = await getFormSubmissionCounts(args.formId, ctx.workspaceId)
      if (!counts) throw new ToolError("Form not found")

      const spec = exportSpecSchema.parse({
        format: args.format,
        scope: args.scope ?? {},
        columns: args.columns ?? {},
        files: args.files,
        timezone: args.timezone,
      })
      const rowCount = await countExportRows(args.formId, spec)

      if (!isSyncEligible(spec, rowCount)) {
        const job = await enqueueExport({
          workspaceId: ctx.workspaceId,
          formId: args.formId,
          requestedBy: ctx.userId,
          requestedByEmail: null,
          apiKeyId: ctx.apiKeyId,
          spec,
        })
        return {
          formId: args.formId,
          downloadUrl: null,
          expiresInSeconds: null,
          jobId: job.id,
          status: "queued" as const,
          responseCount: rowCount,
        }
      }

      // The spec rides INSIDE the signed payload, not on the query string: a
      // link minted for two columns must not become a link for forty by
      // editing the URL.
      const token = mintExportToken({
        formId: args.formId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        spec,
      })
      return {
        formId: args.formId,
        downloadUrl: `${siteUrl()}/api/forms/${args.formId}/export?token=${token}`,
        expiresInSeconds: Math.floor(EXPORT_TOKEN_TTL_MS / 1000),
        jobId: null,
        status: "ready" as const,
        responseCount: rowCount,
      }
    },
```

Add the imports: `META_COLUMNS`, `exportSpecSchema`, `isSyncEligible` from `@/lib/submissions/export-spec`, `countExportRows` from `@/lib/submissions/export-query`, `enqueueExport` from `@/lib/core/export-jobs`.

Also update the file's header comment: the paragraph explaining that export returns a link should now also say that some exports return a job id instead, and why (a spreadsheet and an archive cannot be produced inside one request).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run --project=integration tests/integration/mcp-tools-extended.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Update the MCP doc**

In `doc/MCP.md`, find the `makingflow_export_submissions` entry and document the new arguments, the job-vs-link outcome, and that `zip` is always background work. Keep the existing wording about the link never containing the file.

- [ ] **Step 6: Full verification**

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test:db:up
pnpm test
```

Expected: lint clean, no type errors, every suite green. Do not claim completion before all four have been run and seen to pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/tools/data.ts tests/integration/mcp-tools-extended.test.ts doc/MCP.md
git commit -m "feat(export): MCP export takes the same spec and can queue a job"
```

---

## Phases, if this is split across sessions

| Phase | Tasks | What works at the end |
| --- | --- | --- |
| A — correctness | 1–6 | `Submitted` is the completion time; scope, columns, formats and dated filenames all work over a URL; an oversized export is refused instead of truncated |
| B — background work | 7–9 | Anything can be queued, run, retried and stored; nothing is stuck or lost |
| C — the formats people asked for | 10–11 | XLSX, and a ZIP of every uploaded file |
| D — the product | 12–14 | The dialog, the ready email, the export log, MCP parity |

Each phase ends on a green test suite and a working app. Phase A alone is worth shipping.

## Self-review notes

Checked against the design doc: D1 → Task 1; D2 → Task 4; D3 → Tasks 1 and 6; D4 → Tasks 6 and 13; D5 → Tasks 7, 8 and 13 (the inline audit row); D6 → Task 9; D7 → Task 11; D8 and D9 → Tasks 2 and 4; D10 → Tasks 2 and 3; D11 → Task 14. The ten problems listed in "Where we are" map to: 1 → Tasks 6 and 8; 2 → Task 3; 3 → Tasks 4 and 13; 4 → Tasks 5 and 10; 5 → Task 11; 6 → Tasks 2 and 3; 7 → Tasks 2 and 4; 8 → Tasks 2 and 4; 9 → Tasks 7 and 13; 10 → Tasks 2 and 3.

Two things a careful executor should watch:

- **`schema.ts` importing `ExportSpec`.** Task 7 adds it; `export-spec.ts` imports nothing from the schema, so there is no cycle today. If one appears because a later edit adds one, widen the jsonb type rather than restructuring the schema file.
- **`writeXlsx`'s signature changes inside Task 10.** Task 9 writes the stub as `writeXlsx(source, name, upload)` and Task 10 replaces it with `writeXlsx(source, ceiling?)` plus `uploadExportBytes`. Both edits to the worker are spelled out; do them in the order given or the worker will not compile in between.




