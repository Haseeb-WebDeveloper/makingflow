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
      out.push({
        kind: "removed",
        question: q,
        header: `${markdownToPlainText(q) || "Untitled"} (removed)`,
      })
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
