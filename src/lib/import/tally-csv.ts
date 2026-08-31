import type { EditorField } from "@/lib/builder/form-model"
import type { AnswerValue } from "@/lib/db/schema"

/**
 * Reading Tally's response export.
 *
 * The public form page carries the QUESTIONS but never the ANSWERS — those are
 * only in the owner's account. Tally's CSV export (free plan, Submissions tab)
 * is the credential-free way to get them, so this module joins that file to the
 * form we just imported.
 *
 * The join key is the question label, because that is all a CSV header gives us.
 * That is why the form has to be imported first: its labels come from the same
 * Tally form, so they match exactly rather than approximately.
 */

/** Columns Tally writes that describe the submission rather than answer it. */
const META_HEADERS: Record<string, "id" | "respondent" | "submittedAt"> = {
  "submission id": "id",
  id: "id",
  "respondent id": "respondent",
  "submitted at": "submittedAt",
  "submitted on": "submittedAt",
  submitted: "submittedAt",
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * RFC 4180 parser.
 *
 * Hand-written rather than a dependency: this reads one machine-generated
 * format, the whole grammar is quotes/commas/newlines, and a 40-line function
 * we can test beats a parser whose edge cases we would never exercise. The
 * cases that actually matter for Tally exports are long text answers containing
 * commas, newlines and quotes — all covered in the tests.
 */
export function parseCsv(text: string): string[][] {
  // Excel writes a BOM; left in place it becomes part of the first header and
  // silently stops the first column from matching anything.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ""
  }
  const endRow = () => {
    endField()
    // A trailing newline would otherwise add a row holding one empty string.
    if (row.length > 1 || row[0] !== "") rows.push(row)
    row = []
  }

  while (i < src.length) {
    const c = src[i]

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"' // "" is an escaped quote inside a quoted field
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }

    if (c === '"' && field === "") {
      quoted = true
      i += 1
      continue
    }
    if (c === ",") {
      endField()
      i += 1
      continue
    }
    if (c === "\r") {
      // Treat CRLF and a lone CR as one row terminator.
      if (src[i + 1] === "\n") i += 1
      endRow()
      i += 1
      continue
    }
    if (c === "\n") {
      endRow()
      i += 1
      continue
    }
    field += c
    i += 1
  }

  if (field !== "" || row.length > 0) endRow()
  return rows
}

// ── Column matching ─────────────────────────────────────────────────────────

/** Fold a header and a label to the same key so they can be compared. Shared
 *  with the API path, which falls back to it when identity matching fails. */
export const normaliseLabel = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?:.]+$/, "")

export type ColumnPlan = {
  /** Column index → the field its values answer. */
  answers: { index: number; field: EditorField }[]
  idColumn: number | null
  submittedAtColumn: number | null
  /** Headers we could not place, surfaced so nothing goes missing quietly. */
  unmatched: string[]
  /** Imported questions with no column — normally fine (added after export). */
  unusedFields: EditorField[]
}

/**
 * Decide which CSV column answers which question.
 *
 * Matching is on the normalised label. Duplicates are consumed in order, so a
 * form with two questions named "Name" maps its first column to the first one —
 * the same order Tally exports them in.
 */
export function planColumns(headers: string[], fields: EditorField[]): ColumnPlan {
  const answerable = fields.filter((f) => f.label.trim() !== "" && !isContent(f.type))
  const byLabel = new Map<string, EditorField[]>()
  for (const f of answerable) {
    const key = normaliseLabel(f.label)
    const bucket = byLabel.get(key)
    if (bucket) bucket.push(f)
    else byLabel.set(key, [f])
  }

  const plan: ColumnPlan = {
    answers: [],
    idColumn: null,
    submittedAtColumn: null,
    unmatched: [],
    unusedFields: [],
  }
  const used = new Set<string>()

  headers.forEach((header, index) => {
    const key = normaliseLabel(header)
    const meta = META_HEADERS[key]
    if (meta === "id") {
      plan.idColumn ??= index
      return
    }
    if (meta === "submittedAt") {
      plan.submittedAtColumn ??= index
      return
    }
    if (meta === "respondent") return

    const bucket = byLabel.get(key)
    const field = bucket?.shift()
    if (field) {
      plan.answers.push({ index, field })
      used.add(field.id)
      return
    }
    if (header.trim()) plan.unmatched.push(header.trim())
  })

  plan.unusedFields = answerable.filter((f) => !used.has(f.id))
  return plan
}

const CONTENT_TYPES = new Set(["heading", "paragraph", "image", "embed", "page_break"])
const isContent = (type: string) => CONTENT_TYPES.has(type)

// ── Values ──────────────────────────────────────────────────────────────────

const MULTI_TYPES = new Set(["multi_select", "checkboxes", "ranking"])
const NUMBER_TYPES = new Set(["rating", "scale", "nps"])

/**
 * A CSV cell as a stored answer value, or null when the question was skipped.
 *
 * Multi-answer questions are the awkward case: Tally joins the chosen options
 * with ", " and an option label may itself contain a comma. So the whole cell is
 * checked against the known options FIRST, and only split when it isn't one —
 * which turns "Sales, marketing and PR" into one option rather than three.
 */
export function coerceAnswer(field: EditorField, raw: string): AnswerValue | null {
  const value = raw.trim()
  if (!value) return null

  if (MULTI_TYPES.has(field.type)) return splitChoices(value, field)

  if (NUMBER_TYPES.has(field.type)) {
    const n = Number(value)
    // Not a number after all (a scale exported with its label, say) — keep the
    // text rather than storing NaN or dropping the answer.
    return Number.isFinite(n) ? n : value
  }

  if (field.type === "file_upload") {
    const urls = value.split(",").map((u) => u.trim()).filter(Boolean)
    if (urls.length === 0) return null
    return { files: urls.map((url) => ({ name: fileNameFromUrl(url), url })) }
  }

  return value
}

function splitChoices(value: string, field: EditorField): string[] {
  const labels = new Set((field.options ?? []).map((o) => o.label))
  if (labels.has(value)) return [value]
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [value]
}

/** Last path segment of a URL, for the file's display name. */
export function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop()
    return last ? decodeURIComponent(last) : "file"
  } catch {
    return "file"
  }
}

// ── Rows → submissions ──────────────────────────────────────────────────────

export type ImportedAnswer = {
  fieldId: string
  question: string
  type: EditorField["type"]
  value: AnswerValue
}

export type ImportedSubmission = {
  /** Tally's own submission id, kept so a re-run can skip what it already wrote. */
  externalId: string | null
  submittedAt: Date | null
  answers: ImportedAnswer[]
}

export type CsvImportPlan = {
  submissions: ImportedSubmission[]
  unmatched: string[]
  unusedFields: EditorField[]
  /** Rows that held no answer at all — a respondent who opened and left. */
  emptyRows: number
}

/**
 * Turn an exported CSV into submissions ready to insert against an imported
 * form. Pure: it touches no database, so the whole mapping is unit-testable and
 * the action stays a thin wrapper around it.
 */
export function planCsvImport(csv: string, fields: EditorField[]): CsvImportPlan {
  const rows = parseCsv(csv)
  if (rows.length === 0) {
    return { submissions: [], unmatched: [], unusedFields: [], emptyRows: 0 }
  }

  const [headers, ...body] = rows
  const plan = planColumns(headers, fields)
  const submissions: ImportedSubmission[] = []
  let emptyRows = 0

  for (const row of body) {
    const answers: ImportedAnswer[] = []
    for (const { index, field } of plan.answers) {
      const value = coerceAnswer(field, row[index] ?? "")
      if (value === null) continue
      answers.push({ fieldId: field.id, question: field.label, type: field.type, value })
    }
    if (answers.length === 0) {
      emptyRows += 1
      continue
    }
    submissions.push({
      externalId: plan.idColumn === null ? null : (row[plan.idColumn]?.trim() || null),
      submittedAt: parseImportDate(plan.submittedAtColumn === null ? "" : row[plan.submittedAtColumn]),
      answers,
    })
  }

  return {
    submissions,
    unmatched: plan.unmatched,
    unusedFields: plan.unusedFields,
    emptyRows,
  }
}

/**
 * The export's timestamp. Null when unreadable, so the caller can fall back to
 * "now" — an import that silently dated every historical response to today
 * would corrupt the insights charts it feeds.
 */
export function parseImportDate(raw: string | undefined): Date | null {
  const value = raw?.trim()
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  // A parse that lands in the future is a misread format, not a real date.
  return parsed.getTime() > Date.now() + 86_400_000 ? null : parsed
}
