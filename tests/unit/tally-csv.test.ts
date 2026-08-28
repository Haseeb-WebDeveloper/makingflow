/**
 * Reading Tally's CSV export.
 *
 * The parser is hand-written, so these tests carry the weight a dependency's
 * own test suite would otherwise carry: quoted commas, embedded newlines,
 * escaped quotes, CRLF and a BOM are the whole grammar, and a long text answer
 * in a real export hits all of them.
 */
import { describe, expect, test } from "vitest"
import {
  coerceAnswer,
  parseCsv,
  planColumns,
  planCsvImport,
} from "@/lib/import/tally-csv"
import type { EditorField } from "@/lib/builder/form-model"

const field = (f: Partial<EditorField> & { id: string; label: string }): EditorField => ({
  type: "short_text",
  required: false,
  ...f,
})

describe("parseCsv", () => {
  test("reads a plain table", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ])
  })

  test("keeps commas inside quoted fields", () => {
    expect(parseCsv('name,note\n"Smith, John","Sales, marketing and PR"')).toEqual([
      ["name", "note"],
      ["Smith, John", "Sales, marketing and PR"],
    ])
  })

  test("keeps newlines inside quoted fields", () => {
    // The case that rules out splitting on "\n" — a long-text answer is one row.
    const rows = parseCsv('id,feedback\n1,"Line one\nLine two\nLine three"\n2,short')
    expect(rows).toHaveLength(3)
    expect(rows[1][1]).toBe("Line one\nLine two\nLine three")
    expect(rows[2]).toEqual(["2", "short"])
  })

  test('unescapes "" to a single quote', () => {
    expect(parseCsv('q\n"She said ""hello"" twice"')[1][0]).toBe('She said "hello" twice')
  })

  test("handles CRLF and a lone CR", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]])
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]])
  })

  test("strips the BOM Excel writes", () => {
    // Left in, it becomes part of the first header and that column matches nothing.
    const rows = parseCsv("﻿Submission ID,Name\n1,Ada")
    expect(rows[0][0]).toBe("Submission ID")
  })

  test("keeps empty cells and drops a trailing newline", () => {
    expect(parseCsv("a,b,c\n1,,3\n")).toEqual([["a", "b", "c"], ["1", "", "3"]])
  })

  test("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([])
  })
})

describe("planColumns", () => {
  const fields = [
    field({ id: "f1", label: "What's your name?" }),
    field({ id: "f2", label: "Email", type: "email" }),
  ]

  test("recognises Tally's own columns and matches the rest by label", () => {
    const plan = planColumns(
      ["Submission ID", "Respondent ID", "Submitted at", "What's your name?", "Email"],
      fields,
    )
    expect(plan.idColumn).toBe(0)
    expect(plan.submittedAtColumn).toBe(2)
    expect(plan.answers.map((a) => [a.index, a.field.id])).toEqual([[3, "f1"], [4, "f2"]])
    expect(plan.unmatched).toEqual([])
  })

  test("matches despite case, spacing and trailing punctuation", () => {
    const plan = planColumns(["  what's   your name  ", "email:"], fields)
    expect(plan.answers.map((a) => a.field.id)).toEqual(["f1", "f2"])
  })

  test("reports a column it cannot place", () => {
    const plan = planColumns(["Email", "Some question we removed"], fields)
    expect(plan.unmatched).toEqual(["Some question we removed"])
    expect(plan.unusedFields.map((f) => f.id)).toEqual(["f1"])
  })

  test("maps duplicate labels left to right", () => {
    const dupes = [field({ id: "a", label: "Name" }), field({ id: "b", label: "Name" })]
    const plan = planColumns(["Name", "Name"], dupes)
    expect(plan.answers.map((a) => a.field.id)).toEqual(["a", "b"])
  })

  test("never matches a column to a content block", () => {
    const withContent = [...fields, field({ id: "h", label: "Email", type: "heading" })]
    const plan = planColumns(["Email"], withContent)
    expect(plan.answers[0].field.id).toBe("f2")
  })
})

describe("coerceAnswer", () => {
  test("skips an unanswered question", () => {
    expect(coerceAnswer(field({ id: "a", label: "x" }), "   ")).toBeNull()
  })

  test("stores ratings and scales as numbers", () => {
    expect(coerceAnswer(field({ id: "a", label: "x", type: "rating" }), "4")).toBe(4)
    expect(coerceAnswer(field({ id: "a", label: "x", type: "nps" }), "10")).toBe(10)
  })

  test("keeps the text when a numeric answer isn't a number", () => {
    expect(coerceAnswer(field({ id: "a", label: "x", type: "scale" }), "Very likely")).toBe(
      "Very likely",
    )
  })

  test("splits multi-select answers", () => {
    const f = field({
      id: "a",
      label: "x",
      type: "checkboxes",
      options: [
        { id: "1", label: "Email" },
        { id: "2", label: "SMS" },
      ],
    })
    expect(coerceAnswer(f, "Email, SMS")).toEqual(["Email", "SMS"])
  })

  test("does not split an option that contains a comma", () => {
    // The reason the whole cell is checked against the options first: this would
    // otherwise import as three separate selections that match no option at all.
    const f = field({
      id: "a",
      label: "x",
      type: "multi_select",
      options: [{ id: "1", label: "Sales, marketing and PR" }],
    })
    expect(coerceAnswer(f, "Sales, marketing and PR")).toEqual(["Sales, marketing and PR"])
  })

  test("stores uploads in the shape answerFiles expects", () => {
    const f = field({ id: "a", label: "CV", type: "file_upload" })
    expect(coerceAnswer(f, "https://x.test/uploads/cv%20final.pdf")).toEqual({
      files: [{ name: "cv final.pdf", url: "https://x.test/uploads/cv%20final.pdf" }],
    })
  })
})

describe("planCsvImport", () => {
  const fields = [
    field({ id: "f1", label: "Name" }),
    field({ id: "f2", label: "Rating", type: "rating" }),
  ]
  const csv = [
    "Submission ID,Submitted at,Name,Rating",
    "sub_1,2026-01-15T10:00:00Z,Ada,5",
    "sub_2,2026-02-01T09:30:00Z,Grace,4",
  ].join("\n")

  test("builds one submission per row, with its real date", () => {
    const plan = planCsvImport(csv, fields)
    expect(plan.submissions).toHaveLength(2)
    expect(plan.submissions[0]).toMatchObject({ externalId: "sub_1" })
    expect(plan.submissions[0].submittedAt?.toISOString()).toBe("2026-01-15T10:00:00.000Z")
    expect(plan.submissions[0].answers).toEqual([
      { fieldId: "f1", question: "Name", type: "short_text", value: "Ada" },
      { fieldId: "f2", question: "Rating", type: "rating", value: 5 },
    ])
  })

  test("counts rows with no answers instead of importing blanks", () => {
    const plan = planCsvImport(`${csv}\nsub_3,2026-02-02T09:30:00Z,,`, fields)
    expect(plan.submissions).toHaveLength(2)
    expect(plan.emptyRows).toBe(1)
  })

  test("refuses to guess a date it cannot read", () => {
    // Null means the caller falls back to now(); a wrong guess would silently
    // backdate or post-date real history in the insights charts.
    const plan = planCsvImport("Submitted at,Name\nnot a date,Ada", fields)
    expect(plan.submissions[0].submittedAt).toBeNull()
  })

  test("rejects a date in the future as a misread format", () => {
    const plan = planCsvImport("Submitted at,Name\n3025-01-01,Ada", fields)
    expect(plan.submissions[0].submittedAt).toBeNull()
  })

  test("has no external id when the export omits one", () => {
    const plan = planCsvImport("Name,Rating\nAda,5", fields)
    expect(plan.submissions[0].externalId).toBeNull()
  })

  test("returns nothing for an empty file", () => {
    expect(planCsvImport("", fields).submissions).toEqual([])
  })
})
