import type { AnswerValue, FieldCondition } from "@/lib/db/schema"
import { testCondition, conditionComplete, type Operator } from "@/lib/builder/logic"

export type FilterColumn = {
  id: string
  label: string
  type: string
  options: { id: string; label: string }[] | null
}
export type RawRow = {
  id: string
  submittedAt: string
  values: Record<string, AnswerValue>
  aiSummary?: string | null
  aiScore?: number | null
  aiScreenReason?: string | null
}
export type Filter = FieldCondition // { fieldId, operator, value? }
export type MatchMode = "all" | "any"

export type FieldKind = "text" | "number" | "single" | "multi" | "date" | "file"

const NUMERIC = new Set(["rating", "scale", "nps"])
const SINGLE = new Set(["multiple_choice", "dropdown", "yes_no"])
const MULTI = new Set(["checkboxes", "multi_select", "ranking"])
const DATE = new Set(["date", "time"])

export function fieldKind(type: string): FieldKind {
  if (NUMERIC.has(type)) return "number"
  if (SINGLE.has(type)) return "single"
  if (MULTI.has(type)) return "multi"
  if (DATE.has(type)) return "date"
  if (type === "file_upload" || type === "signature") return "file"
  return "text"
}

const OPS: Record<FieldKind, Operator[]> = {
  text: ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty"],
  single: ["equals", "not_equals", "is_empty", "is_not_empty"],
  multi: ["contains", "not_contains", "is_empty", "is_not_empty"],
  date: ["equals", "greater_than", "less_than", "is_empty", "is_not_empty"],
  file: ["is_empty", "is_not_empty"],
}

export function operatorsForType(type: string): Operator[] {
  return OPS[fieldKind(type)]
}

const LABELS: Record<Operator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  greater_than: "greater than",
  less_than: "less than",
  is_empty: "is empty",
  is_not_empty: "is not empty",
}

export function operatorLabel(op: Operator, kind: FieldKind): string {
  if (kind === "date") {
    if (op === "equals") return "is on"
    if (op === "greater_than") return "is after"
    if (op === "less_than") return "is before"
  }
  return LABELS[op]
}

export function valueToText(v: AnswerValue | undefined): string {
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "object") {
    const files = (v as { files?: { name?: string }[] }).files
    if (Array.isArray(files)) return files.map((f) => f?.name ?? "file").join(", ")
    return JSON.stringify(v)
  }
  return String(v)
}

const toStr = (v: unknown) => (v == null ? "" : String(v))

// ISO date/time strings sort lexicographically in chronological order, so
// before/after comparisons are string comparisons (testCondition would coerce
// them to NaN via Number()).
function evalFilter(c: Filter, values: Record<string, AnswerValue>, kind: FieldKind): boolean {
  if (kind === "date" && (c.operator === "greater_than" || c.operator === "less_than")) {
    const v = toStr(values[c.fieldId])
    if (!v) return false
    return c.operator === "greater_than" ? v > toStr(c.value) : v < toStr(c.value)
  }
  return testCondition(c, values)
}

/** Filter rows by a free-text search (across all cells) AND a set of field
 * conditions joined with all/any. Pure client-side over the loaded rows. */
export function applyFilters(
  rows: RawRow[],
  columns: FilterColumn[],
  opts: { search: string; filters: Filter[]; match: MatchMode },
): RawRow[] {
  const q = opts.search.trim().toLowerCase()
  const valid = opts.filters.filter(conditionComplete)
  if (!q && valid.length === 0) return rows

  const kinds = new Map(columns.map((c) => [c.id, fieldKind(c.type)]))
  return rows.filter((r) => {
    if (q) {
      const hay = columns.map((c) => valueToText(r.values[c.id])).join("  ").toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (valid.length === 0) return true
    const results = valid.map((c) => evalFilter(c, r.values, kinds.get(c.fieldId) ?? "text"))
    return opts.match === "any" ? results.some(Boolean) : results.every(Boolean)
  })
}
