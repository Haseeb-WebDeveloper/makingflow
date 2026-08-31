/**
 * Joining Tally's API responses to the fields we imported.
 *
 * The join is the reason this path exists, so most of these tests are about it
 * rather than about value conversion: an answer that lands on the wrong
 * question, or on no question, is the failure that matters.
 */
import { describe, expect, test } from "vitest"
import { coerceApiAnswer, planApiImport } from "@/lib/import/tally-answers"
import type { TallyFieldRef } from "@/lib/import/tally-blocks"
import type { EditorField } from "@/lib/builder/form-model"

const field = (f: Partial<EditorField> & { id: string; label: string }): EditorField => ({
  type: "short_text",
  required: false,
  ...f,
})

const ref = (fieldId: string, groupUuid?: string, optionLabels: Record<string, string> = {}):
  TallyFieldRef => ({ fieldId, groupUuid, optionLabels })

const question = (id: string, title: string, groupUuid?: string) => ({
  id,
  title,
  fields: groupUuid ? [{ blockGroupUuid: groupUuid }] : [],
})

const row = (id: string, responses: { questionId: string; answer?: unknown; formattedAnswer?: string }[]) => ({
  id,
  isCompleted: true,
  submittedAt: "2026-03-04T11:00:00Z",
  responses,
})

describe("matching questions to fields", () => {
  const fields = [field({ id: "f1", label: "Your name" })]
  const refs = [ref("f1", "g1")]

  test("joins on block group identity", () => {
    const plan = planApiImport(fields, refs, [question("Q1", "Your name", "g1")], [
      row("s1", [{ questionId: "Q1", answer: "Ada" }]),
    ])
    expect(plan.submissions[0].answers).toEqual([
      { fieldId: "f1", question: "Your name", type: "short_text", value: "Ada" },
    ])
  })

  test("still joins when the question was renamed after the responses came in", () => {
    // The whole reason this path beats the CSV one: the wording moved on, the
    // identity didn't.
    const plan = planApiImport(fields, refs, [question("Q1", "What should we call you?", "g1")], [
      row("s1", [{ questionId: "Q1", answer: "Ada" }]),
    ])
    expect(plan.submissions[0].answers[0].fieldId).toBe("f1")
    expect(plan.unmatched).toEqual([])
  })

  test("falls back to the label when the group is unknown", () => {
    // A form edited between reading its blocks and reading its submissions.
    const plan = planApiImport(fields, refs, [question("Q1", "  your NAME? ", "gX")], [
      row("s1", [{ questionId: "Q1", answer: "Ada" }]),
    ])
    expect(plan.submissions[0].answers[0].fieldId).toBe("f1")
  })

  test("reports a question it cannot place", () => {
    const plan = planApiImport(fields, refs, [question("Q9", "A question we skipped", "gZ")], [
      row("s1", [{ questionId: "Q9", answer: "x" }]),
    ])
    expect(plan.unmatched).toEqual(["A question we skipped"])
    expect(plan.submissions).toEqual([])
    expect(plan.emptyRows).toBe(1)
  })

  test("never lets two questions claim the same field", () => {
    // `answers` is uniquely indexed on (submission_id, field_id) — a double
    // match would abort the insert for the whole chunk, not just be wrong.
    const plan = planApiImport(
      fields,
      refs,
      [question("Q1", "Your name", "g1"), question("Q2", "Your name", "gX")],
      [row("s1", [{ questionId: "Q1", answer: "Ada" }, { questionId: "Q2", answer: "Grace" }])],
    )
    expect(plan.submissions[0].answers).toHaveLength(1)
    expect(plan.unmatched).toEqual(["Your name"])
  })

  test("ignores a response repeating a question id", () => {
    const plan = planApiImport(fields, refs, [question("Q1", "Your name", "g1")], [
      row("s1", [{ questionId: "Q1", answer: "Ada" }, { questionId: "Q1", answer: "Grace" }]),
    ])
    expect(plan.submissions[0].answers).toHaveLength(1)
    expect(plan.submissions[0].answers[0].value).toBe("Ada")
  })
})

describe("submission rows", () => {
  const fields = [field({ id: "f1", label: "Name" })]
  const refs = [ref("f1", "g1")]
  const questions = [question("Q1", "Name", "g1")]

  test("keeps Tally's id and its real date", () => {
    const plan = planApiImport(fields, refs, questions, [
      row("s1", [{ questionId: "Q1", answer: "Ada" }]),
    ])
    expect(plan.submissions[0].externalId).toBe("s1")
    expect(plan.submissions[0].submittedAt?.toISOString()).toBe("2026-03-04T11:00:00.000Z")
  })

  test("counts a row that answered nothing we kept", () => {
    const plan = planApiImport(fields, refs, questions, [
      row("s1", [{ questionId: "Q1", answer: "" }]),
    ])
    expect(plan.submissions).toEqual([])
    expect(plan.emptyRows).toBe(1)
  })
})

describe("coerceApiAnswer", () => {
  const options = { "opt-a": "Email", "opt-b": "SMS" }

  test("resolves a choice uuid to the label we imported", () => {
    const f = field({ id: "a", label: "x", type: "multiple_choice" })
    expect(coerceApiAnswer(f, { answer: "opt-a" }, options)).toBe("Email")
  })

  test("resolves a list of choice uuids", () => {
    const f = field({ id: "a", label: "x", type: "checkboxes" })
    expect(coerceApiAnswer(f, { answer: ["opt-a", "opt-b"] }, options)).toEqual(["Email", "SMS"])
  })

  test("keeps a choice value that isn't a uuid we know", () => {
    const f = field({ id: "a", label: "x", type: "multiple_choice" })
    expect(coerceApiAnswer(f, { answer: "Something typed" }, options)).toBe("Something typed")
  })

  test("wraps a single answer for a multi-answer question", () => {
    const f = field({ id: "a", label: "x", type: "multi_select" })
    expect(coerceApiAnswer(f, { answer: "opt-b" }, options)).toEqual(["SMS"])
  })

  test("stores ratings and scales as numbers, however they arrive", () => {
    const f = field({ id: "a", label: "x", type: "rating" })
    expect(coerceApiAnswer(f, { answer: 4 })).toBe(4)
    expect(coerceApiAnswer(f, { answer: "4" })).toBe(4)
  })

  test("reads uploads as objects or bare urls", () => {
    const f = field({ id: "a", label: "CV", type: "file_upload" })
    expect(
      coerceApiAnswer(f, { answer: [{ url: "https://x.test/a.pdf", name: "CV.pdf" }] }),
    ).toEqual({ files: [{ name: "CV.pdf", url: "https://x.test/a.pdf" }] })
    expect(coerceApiAnswer(f, { answer: "https://x.test/uploads/cv%20final.pdf" })).toEqual({
      files: [{ name: "cv final.pdf", url: "https://x.test/uploads/cv%20final.pdf" }],
    })
  })

  test("turns a boolean into words", () => {
    const f = field({ id: "a", label: "Subscribe?", type: "checkboxes" })
    expect(coerceApiAnswer(f, { answer: true })).toEqual(["Yes"])
    expect(coerceApiAnswer(field({ id: "b", label: "x" }), { answer: false })).toBe("No")
  })

  test("falls back to formattedAnswer for a shape it doesn't know", () => {
    // Tally documents `answer` as "string | number | boolean | array | object"
    // and gives an example for one of those. This is what keeps the other four
    // from being silently dropped.
    const f = field({ id: "a", label: "Address" })
    expect(
      coerceApiAnswer(f, {
        answer: { city: "Lahore", country: "PK" },
        formattedAnswer: "Lahore, PK",
      }),
    ).toBe("Lahore, PK")
  })

  test("reads a labelled object out of a list", () => {
    const f = field({ id: "a", label: "x", type: "multi_select" })
    expect(coerceApiAnswer(f, { answer: [{ id: "opt-a", text: "Email" }] }, options)).toEqual([
      "Email",
    ])
  })

  test("returns null when there is nothing to store", () => {
    const f = field({ id: "a", label: "x" })
    expect(coerceApiAnswer(f, { answer: null })).toBeNull()
    expect(coerceApiAnswer(f, { answer: "   " })).toBeNull()
    expect(coerceApiAnswer(f, {})).toBeNull()
    expect(coerceApiAnswer(f, { answer: {}, formattedAnswer: "  " })).toBeNull()
  })
})
