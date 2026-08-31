import type { EditorField } from "@/lib/builder/form-model"
import type { AnswerValue } from "@/lib/db/schema"
import type { TallyFieldRef } from "@/lib/import/tally-blocks"
import type { TallyApiQuestion, TallyApiResponse, TallyApiSubmission } from "@/lib/import/tally-api"
import {
  fileNameFromUrl,
  normaliseLabel,
  parseImportDate,
  type ImportedAnswer,
  type ImportedSubmission,
} from "@/lib/import/tally-csv"

/**
 * Turning Tally's API responses into submissions of ours.
 *
 * The counterpart to the CSV planner, and the reason the API path is worth
 * having. A CSV can only say "the column headed 'Your name'"; the API says
 * "question EKOE2N", and that question names the block group it was built from
 * — the same `groupUuid` our parser recorded while reading the form. So the
 * join here is on IDENTITY, and survives a question whose wording changed after
 * the responses were collected.
 *
 * Label matching is kept as a fallback rather than dropped, because identity
 * matching has one real failure mode: a form edited in Tally between the moment
 * we read its blocks and the moment we read its submissions. Falling back to
 * the text is better than losing the answer.
 *
 * Pure — no database, no network — so the whole mapping is unit-testable and
 * the action stays a thin wrapper.
 */

const MULTI_TYPES = new Set(["multi_select", "checkboxes", "ranking"])
const NUMBER_TYPES = new Set(["rating", "scale", "nps"])

export type ApiImportPlan = {
  submissions: ImportedSubmission[]
  /** Questions we could not place — surfaced so nothing goes missing quietly. */
  unmatched: string[]
  /**
   * Questions deleted in Tally. Their old answers survive in Tally's history but
   * the blocks are gone, so there is no question here to hang them on. Reported
   * apart from `unmatched` because this is not a failure to match — there is
   * nothing to match — and counting it as one makes a clean import look broken.
   */
  deleted: string[]
  /** Responses that answered nothing we kept (a skipped block type, usually). */
  emptyRows: number
}

type Target = { field: EditorField; ref: TallyFieldRef }

/**
 * Match every API question to the field we imported it as.
 *
 * Refs are CONSUMED as they match. Two questions must never resolve to one
 * field: `answers` carries a unique index on (submission_id, field_id), so a
 * double match would not merely be wrong, it would abort the insert for the
 * whole chunk.
 */
function matchQuestions(
  fields: EditorField[],
  refs: TallyFieldRef[],
  questions: TallyApiQuestion[],
): { targets: Map<string, Target>; unmatched: string[]; deleted: string[] } {
  const fieldById = new Map(fields.map((f) => [f.id, f]))
  const available = new Map<string, TallyFieldRef>()
  for (const ref of refs) {
    if (fieldById.has(ref.fieldId)) available.set(ref.fieldId, ref)
  }

  const byGroup = new Map<string, string>()
  const byLabel = new Map<string, string>()
  for (const ref of available.values()) {
    if (ref.groupUuid) byGroup.set(ref.groupUuid, ref.fieldId)
    const label = normaliseLabel(fieldById.get(ref.fieldId)?.label ?? "")
    // First field wins a duplicated label, matching the CSV planner's
    // left-to-right rule.
    if (label && !byLabel.has(label)) byLabel.set(label, ref.fieldId)
  }

  const targets = new Map<string, Target>()
  const unmatched: string[] = []
  const deleted: string[] = []

  for (const question of questions) {
    const id = typeof question.id === "string" ? question.id : ""
    if (!id || targets.has(id)) continue

    const title = typeof question.title === "string" ? question.title.trim() : ""

    // Removed from the form in Tally. Its blocks are gone, so there is nothing
    // here it could match.
    if (question.isDeleted === true) {
      if (title) deleted.push(title)
      continue
    }

    let fieldId: string | undefined

    // Identity first: any of the question's blocks naming a group we parsed.
    const blocks = Array.isArray(question.fields) ? question.fields : []
    for (const raw of blocks) {
      const group = (raw as { blockGroupUuid?: unknown })?.blockGroupUuid
      if (typeof group === "string" && byGroup.has(group)) {
        fieldId = byGroup.get(group)
        break
      }
    }

    // Then the wording, for a form edited between our two reads.
    if (!fieldId && title) fieldId = byLabel.get(normaliseLabel(title))

    const ref = fieldId ? available.get(fieldId) : undefined
    const field = fieldId ? fieldById.get(fieldId) : undefined
    if (!ref || !field) {
      if (title) unmatched.push(title)
      continue
    }

    targets.set(id, { field, ref })
    available.delete(fieldId as string)
    if (ref.groupUuid) byGroup.delete(ref.groupUuid)
    byLabel.delete(normaliseLabel(field.label))
  }

  return { targets, unmatched, deleted }
}

/**
 * Build the submissions to insert.
 *
 * `fields` are the fields as imported, `refs` what the parser recorded about
 * where each came from, and `questions`/`rows` the two halves of the API's
 * submissions response.
 */
export function planApiImport(
  fields: EditorField[],
  refs: TallyFieldRef[],
  questions: TallyApiQuestion[],
  rows: TallyApiSubmission[],
): ApiImportPlan {
  const { targets, unmatched, deleted } = matchQuestions(fields, refs, questions)
  const submissions: ImportedSubmission[] = []
  let emptyRows = 0

  for (const row of rows) {
    const responses = Array.isArray(row.responses) ? (row.responses as TallyApiResponse[]) : []
    const answers: ImportedAnswer[] = []
    // A malformed response list could name the same question twice; the unique
    // index on (submission_id, field_id) would reject the second one.
    const answered = new Set<string>()

    for (const response of responses) {
      const questionId = typeof response.questionId === "string" ? response.questionId : ""
      const target = targets.get(questionId)
      if (!target || answered.has(target.field.id)) continue

      const value = coerceApiAnswer(target.field, response, target.ref.optionLabels)
      if (value === null) continue

      answered.add(target.field.id)
      answers.push({
        fieldId: target.field.id,
        question: target.field.label,
        type: target.field.type,
        value,
      })
    }

    if (answers.length === 0) {
      emptyRows += 1
      continue
    }

    submissions.push({
      externalId: typeof row.id === "string" && row.id.trim() ? row.id.trim() : null,
      submittedAt: parseImportDate(
        typeof row.submittedAt === "string" ? row.submittedAt : undefined,
      ),
      answers,
    })
  }

  return { submissions, unmatched, deleted, emptyRows }
}

/**
 * One response as a stored answer value, or null when nothing was answered.
 *
 * Tally's schema types `answer` as "string | number | boolean | array | object
 * | null" and the published docs give an example for exactly one of those — a
 * text input. Checked against a real account, the shapes that actually turn up
 * are: text and dates as strings, numbers for scales, an array of option LABELS
 * (not uuids) for choices, and `[{ id, name, url, mimeType, size }]` for
 * uploads. Every one is handled above.
 *
 * `formattedAnswer` is in Tally's published schema but absent from live
 * responses, so the fallback below is a safety net for a shape we have not met
 * — not a path anything relies on. An unknown shape degrades to readable text
 * where one is offered, rather than vanishing.
 */
export function coerceApiAnswer(
  field: EditorField,
  response: Pick<TallyApiResponse, "answer" | "formattedAnswer">,
  optionLabels: Record<string, string> = {},
): AnswerValue | null {
  const value = fromAnswer(field, response.answer, optionLabels)
  if (value !== null) return value

  const formatted =
    typeof response.formattedAnswer === "string" ? response.formattedAnswer.trim() : ""
  if (!formatted) return null
  return MULTI_TYPES.has(field.type) ? [formatted] : formatted
}

function fromAnswer(
  field: EditorField,
  answer: unknown,
  optionLabels: Record<string, string>,
): AnswerValue | null {
  if (answer === null || answer === undefined) return null

  if (Array.isArray(answer)) {
    if (field.type === "file_upload") return toFiles(answer)
    const labels = answer
      .map((entry) => choiceLabel(entry, optionLabels))
      .filter((label): label is string => Boolean(label))
    if (labels.length === 0) return null
    return MULTI_TYPES.has(field.type) ? labels : labels[0]
  }

  if (typeof answer === "object") {
    // A lone upload, or a shape we have no mapping for — let formattedAnswer try.
    return field.type === "file_upload" ? toFiles([answer]) : null
  }

  if (typeof answer === "boolean") {
    const text = answer ? "Yes" : "No"
    return MULTI_TYPES.has(field.type) ? [text] : text
  }

  if (typeof answer === "number") {
    return MULTI_TYPES.has(field.type) ? [String(answer)] : answer
  }

  if (typeof answer !== "string") return null
  const text = answer.trim()
  if (!text) return null
  // A choice question's answer is an option's uuid, not its wording.
  const resolved = optionLabels[text] ?? text

  if (field.type === "file_upload") return toFiles([resolved])
  if (NUMBER_TYPES.has(field.type)) {
    const n = Number(resolved)
    if (Number.isFinite(n)) return n
  }
  return MULTI_TYPES.has(field.type) ? [resolved] : resolved
}

/** A selected choice as its label, resolving option uuids where we know them. */
function choiceLabel(entry: unknown, optionLabels: Record<string, string>): string | null {
  if (typeof entry === "string") {
    const text = entry.trim()
    if (!text) return null
    return optionLabels[text] ?? text
  }
  if (typeof entry === "number" || typeof entry === "boolean") return String(entry)

  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>
    for (const key of ["text", "label", "title", "name", "value"]) {
      const v = o[key]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
    if (typeof o.id === "string") return optionLabels[o.id] ?? null
    if (typeof o.uuid === "string") return optionLabels[o.uuid] ?? null
  }
  return null
}

/** Uploads in the shape `answerFiles` reads. */
function toFiles(list: unknown[]): AnswerValue | null {
  const files: { name: string; url: string }[] = []

  for (const item of list) {
    if (typeof item === "string") {
      const url = item.trim()
      if (url) files.push({ name: fileNameFromUrl(url), url })
      continue
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>
      const url = typeof o.url === "string" ? o.url.trim() : ""
      if (!url) continue
      const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : fileNameFromUrl(url)
      files.push({ name, url })
    }
  }

  return files.length > 0 ? { files } : null
}
