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

function metaCell(sub: ExportSubmission, column: Extract<ExportColumn, { kind: "meta" }>): string {
  const tz = column.timezone ?? "UTC"
  switch (column.key) {
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

function cell(sub: ExportSubmission, column: ExportColumn): string {
  switch (column.kind) {
    case "meta":
      return metaCell(sub, column)
    case "field":
      return answerToCell(sub.values[column.fieldId])
    case "removed":
      return answerToCell(sub.removed[column.question])
    case "followUp": {
      const turn = sub.followUps[column.index - 1]
      if (!turn) return ""
      return column.part === "question" ? turn.question : turn.answer
    }
  }
}

export function rowCells(sub: ExportSubmission, columns: ExportColumn[]): string[] {
  return columns.map((c) => cell(sub, c))
}

export function rowObject(sub: ExportSubmission, columns: ExportColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let wantsFollowUps = false
  for (const c of columns) {
    if (c.kind === "followUp") {
      wantsFollowUps = true
      continue
    }
    out[c.header] = cell(sub, c)
  }
  // Nested, not flattened: JSON has no reason to pretend it is a grid.
  if (wantsFollowUps) out.aiFollowUps = sub.followUps
  return out
}
