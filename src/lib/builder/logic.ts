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

function isEmptyVal(v: AnswerValue | undefined): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0)
}
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
