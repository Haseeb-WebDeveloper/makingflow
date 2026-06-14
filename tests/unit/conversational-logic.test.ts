import { describe, expect, test } from "vitest"
import {
  nextAnswerableField,
  NON_ANSWER_TYPES,
  isEmpty,
} from "@/lib/builder/logic"
import { coerceValue, matchOption } from "@/lib/ai/conversational"
import type { FieldLogic } from "@/lib/db/schema"

type F = { id: string; type: string; logic?: FieldLogic | null }

const showIf = (fieldId: string, value: string): FieldLogic => ({
  action: "show",
  match: "all",
  source: "manual",
  conditions: [{ fieldId, operator: "equals", value }],
})

describe("nextAnswerableField", () => {
  test("linear progression and end-of-form", () => {
    const fields: F[] = [
      { id: "a", type: "short_text" },
      { id: "b", type: "short_text" },
    ]
    expect(nextAnswerableField(fields, {}, null)?.id).toBe("a")
    expect(nextAnswerableField(fields, { a: "x" }, "a")?.id).toBe("b")
    expect(nextAnswerableField(fields, { a: "x", b: "y" }, "b")).toBeNull()
  })

  test("skips content/layout blocks", () => {
    const fields: F[] = [
      { id: "h", type: "heading" },
      { id: "p", type: "paragraph" },
      { id: "a", type: "short_text" },
    ]
    expect(nextAnswerableField(fields, {}, null)?.id).toBe("a")
  })

  test("skips already-answered fields (resume lands on first unanswered)", () => {
    const fields: F[] = [
      { id: "a", type: "short_text" },
      { id: "b", type: "short_text" },
      { id: "c", type: "short_text" },
    ]
    expect(nextAnswerableField(fields, { a: "x", b: "y" }, null)?.id).toBe("c")
  })

  test("skips fields hidden by conditional logic", () => {
    const fields: F[] = [
      { id: "a", type: "multiple_choice" },
      { id: "b", type: "short_text", logic: showIf("a", "Yes") },
      { id: "c", type: "short_text" },
    ]
    // a answered "No" -> b hidden -> c next
    expect(nextAnswerableField(fields, { a: "No" }, "a")?.id).toBe("c")
  })

  test("answer-dependent branch is respected", () => {
    const fields: F[] = [
      { id: "pet", type: "yes_no" },
      { id: "petName", type: "short_text", logic: showIf("pet", "Yes") },
    ]
    expect(nextAnswerableField(fields, { pet: "Yes" }, "pet")?.id).toBe("petName")
    expect(nextAnswerableField(fields, { pet: "No" }, "pet")).toBeNull()
  })
})

describe("isEmpty / NON_ANSWER_TYPES", () => {
  test("isEmpty", () => {
    expect(isEmpty(undefined)).toBe(true)
    expect(isEmpty("")).toBe(true)
    expect(isEmpty([])).toBe(true)
    expect(isEmpty(0)).toBe(false)
    expect(isEmpty("x")).toBe(false)
    expect(isEmpty(["x"])).toBe(false)
  })
  test("content types", () => {
    for (const t of ["heading", "paragraph", "image", "embed", "page_break"]) {
      expect(NON_ANSWER_TYPES.has(t)).toBe(true)
    }
    expect(NON_ANSWER_TYPES.has("short_text")).toBe(false)
  })
})

describe("matchOption", () => {
  const opts = [{ label: "Red" }, { label: "Dark Blue" }]
  test("exact (case-insensitive)", () => {
    expect(matchOption("red", opts)).toBe("Red")
  })
  test("contains", () => {
    expect(matchOption("I think dark blue", opts)).toBe("Dark Blue")
  })
  test("no match", () => {
    expect(matchOption("green", opts)).toBeNull()
    expect(matchOption("", opts)).toBeNull()
  })
})

describe("coerceValue", () => {
  test("rating / scale / nps extract the number", () => {
    expect(coerceValue("rating", "yeah around 4 stars")).toBe(4)
    expect(coerceValue("scale", "I'd say 5")).toBe(5)
    expect(coerceValue("nps", "ten? no, 9 really")).toBe(9)
    expect(coerceValue("rating", "no idea")).toBeNull()
  })

  test("yes_no normalizes affirmatives/negatives", () => {
    expect(coerceValue("yes_no", "yeah sure")).toBe("Yes")
    expect(coerceValue("yes_no", "Nope")).toBe("No")
    expect(coerceValue("yes_no", "sì")).toBe("Yes")
    expect(coerceValue("yes_no", "maybe")).toBeNull()
  })

  test("single choice matches an option, else falls back to raw", () => {
    const opts = [{ label: "Red" }, { label: "Blue" }]
    expect(coerceValue("multiple_choice", "blue", opts)).toBe("Blue")
    expect(coerceValue("dropdown", "Green", opts)).toBe("Green")
  })

  test("multi-select splits and matches multiple options", () => {
    const opts = [{ label: "A" }, { label: "B" }, { label: "C" }]
    expect(coerceValue("multi_select", "A and C", opts)).toEqual(["A", "C"])
    expect(coerceValue("checkboxes", "B | C", opts)).toEqual(["B", "C"])
    expect(coerceValue("multi_select", "nothing matches", opts)).toEqual([])
  })

  test("free text passes through; empty is null", () => {
    expect(coerceValue("short_text", "  hello ")).toBe("hello")
    expect(coerceValue("long_text", "")).toBeNull()
  })
})
