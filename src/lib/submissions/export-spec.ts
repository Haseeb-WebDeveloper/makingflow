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
  value: z
    .union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500))])
    .optional(),
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
  const parsed = exportSpecSchema.parse(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
  )
  return { ...parsed, timezone: safeTimezone(parsed.timezone) }
}

/**
 * Read a spec off a URL, falling back rather than failing.
 *
 * A malformed `?spec=` is treated as "no spec". The alternative — a 400 — turns
 * a stale bookmark or a truncated paste into a broken Export button, and the
 * fallback is the export everybody wanted before this parameter existed.
 */
export function parseExportSpec(
  params: URLSearchParams,
  fallback: ExportSpec = DEFAULT_SPEC,
): ExportSpec {
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
