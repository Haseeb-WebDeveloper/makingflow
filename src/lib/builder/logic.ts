import type { FieldLogic, FieldCondition, AnswerValue } from "@/lib/db/schema"

export type Operator = FieldCondition["operator"]

export const LOGIC_OPERATORS: { value: Operator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
]

export const NO_VALUE_OPERATORS = new Set<Operator>(["is_empty", "is_not_empty"])

type Values = Record<string, AnswerValue | undefined>

/** Field types that don't collect an answer (content/layout only). */
export const NON_ANSWER_TYPES = new Set([
  "heading",
  "paragraph",
  "image",
  "embed",
  "page_break",
])

/** An answer is "empty" when it's nullish, a blank string, or an empty array. */
export function isEmpty(v: AnswerValue | undefined): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0)
}

const isEmptyVal = isEmpty
const toStr = (v: unknown) => (v == null ? "" : String(v))

export function conditionComplete(c: FieldCondition): boolean {
  if (!c.fieldId) return false
  if (NO_VALUE_OPERATORS.has(c.operator)) return true
  return c.value != null && c.value !== "" && !(Array.isArray(c.value) && c.value.length === 0)
}

export function testCondition(c: FieldCondition, values: Values): boolean {
  const v = values[c.fieldId]
  const target = c.value
  switch (c.operator) {
    case "is_empty":
      return isEmptyVal(v)
    case "is_not_empty":
      return !isEmptyVal(v)
    case "equals":
      return Array.isArray(v) ? v.map(toStr).includes(toStr(target)) : toStr(v) === toStr(target)
    case "not_equals":
      return Array.isArray(v) ? !v.map(toStr).includes(toStr(target)) : toStr(v) !== toStr(target)
    case "contains":
      return Array.isArray(v)
        ? v.map(toStr).some((x) => x.toLowerCase().includes(toStr(target).toLowerCase()))
        : toStr(v).toLowerCase().includes(toStr(target).toLowerCase())
    case "not_contains":
      return Array.isArray(v)
        ? !v.map(toStr).some((x) => x.toLowerCase().includes(toStr(target).toLowerCase()))
        : !toStr(v).toLowerCase().includes(toStr(target).toLowerCase())
    case "greater_than":
      return Number(v) > Number(target)
    case "less_than":
      return Number(v) < Number(target)
    default:
      return true
  }
}

/**
 * Is a field visible given the current answers? A field with no logic — or only
 * incomplete conditions — is always visible. `show` = visible when matched;
 * `hide` = hidden when matched.
 */
export function isFieldVisible(logic: FieldLogic | undefined, values: Values): boolean {
  if (!logic) return true
  const valid = (logic.conditions ?? []).filter(conditionComplete)
  if (valid.length === 0) return true
  const results = valid.map((c) => testCondition(c, values))
  const matched = logic.match === "any" ? results.some(Boolean) : results.every(Boolean)
  return logic.action === "hide" ? !matched : matched
}

/** Minimal field shape the ordering helper needs — kept structural so both the
 *  runtime's `PublicField` and the builder's editor field satisfy it. */
type FieldLike = { id: string; type: string; logic?: FieldLogic | null }

/**
 * The next field a respondent should answer: scan in document order strictly
 * AFTER `afterFieldId` (or from the start when null), skipping content/layout
 * blocks, fields hidden by their conditional logic, and fields already answered
 * (a non-empty value in `values`). Returns null when no answerable field
 * remains. This is the single ordering authority shared by the conversational
 * client and the per-turn AI endpoint; scanning from the start while skipping
 * answered fields makes resume "land on the first unanswered question" fall out
 * for free.
 */
export function nextAnswerableField<T extends FieldLike>(
  fields: T[],
  values: Values,
  afterFieldId: string | null,
): T | null {
  let reached = afterFieldId == null
  for (const f of fields) {
    if (!reached) {
      if (f.id === afterFieldId) reached = true
      continue
    }
    if (NON_ANSWER_TYPES.has(f.type)) continue
    if (!isFieldVisible(f.logic ?? undefined, values)) continue
    if (!isEmpty(values[f.id])) continue // already answered
    return f
  }
  return null
}

/**
 * The previous answerable field a respondent should land on when stepping back:
 * scan in document order strictly BEFORE `beforeFieldId` and return the LAST
 * one that is answerable and currently visible. Unlike the forward walk this
 * does NOT skip already-answered fields — going back must revisit the field the
 * respondent just filled. Returns null when there's nothing before it (the
 * one-at-a-time runtime uses this for its Back button). Content/layout blocks
 * are skipped; the runtime re-attaches any leading ones when it renders a step.
 */
export function prevAnswerableField<T extends FieldLike>(
  fields: T[],
  values: Values,
  beforeFieldId: string,
): T | null {
  let prev: T | null = null
  for (const f of fields) {
    if (f.id === beforeFieldId) return prev
    if (NON_ANSWER_TYPES.has(f.type)) continue
    if (!isFieldVisible(f.logic ?? undefined, values)) continue
    prev = f
  }
  return prev
}
