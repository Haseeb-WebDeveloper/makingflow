/**
 * Importing a Tally form.
 *
 * The fixture is a REAL public Tally form captured from tally.so/r/3qDpEY —
 * `props.pageProps` verbatim. Hand-written fixtures would have encoded my
 * assumptions about the shape rather than testing them, and the two surprises
 * this parser exists to handle (a question's TITLE living in a different group
 * from the question, and rich text being a recursive tree) are exactly the ones
 * a hand-written fixture would have flattened away.
 */
import { describe, expect, test } from "vitest"
import {
  parseTallyBlocks,
  parseTallySettings,
  richText,
  type TallyBlock,
} from "@/lib/import/tally-blocks"
import fixture from "../fixtures/tally-form.json"

const REAL = fixture as { name: string; blocks: TallyBlock[]; settings: unknown }

const block = (b: Partial<TallyBlock> & { type: string }): TallyBlock => ({
  groupUuid: b.type + "-group",
  ...b,
})

describe("richText", () => {
  test("reads a plain title", () => {
    expect(richText([["How many people work at Tally?"]])).toBe(
      "How many people work at Tally?",
    )
  })

  test("keeps the words and drops mention metadata", () => {
    // The shape that motivated a recursive walk: joining the top level yields
    // "Your score: ,@score,tag,span,mention,1059f3df…" — tag names and a uuid
    // rendered as if they were copy.
    const schema = [
      [
        [
          ["Your score: "],
          ["@score", [["tag", "span"], ["mention", "1059f3df-1305-4464-8abb-2a3e49f5f074"]]],
          ["/3"],
        ],
        [["tag", "span"], ["font-weight", "bold"]],
      ],
    ]
    const text = richText(schema)
    expect(text).toBe("Your score: @score/3")
    expect(text).not.toContain("span")
    expect(text).not.toContain("1059f3df")
  })

  test("survives junk", () => {
    expect(richText(undefined)).toBe("")
    expect(richText([])).toBe("")
    expect(richText("already a string")).toBe("already a string")
  })
})

describe("parseTallyBlocks — the real form", () => {
  const { form, skipped } = parseTallyBlocks(REAL.blocks, REAL.name)

  test("takes the form name over the FORM_TITLE block", () => {
    expect(form.title).toBe("Popup/embed (share)")
  })

  test("finds every question, in order", () => {
    const questions = form.fields.filter((f) => f.type === "multiple_choice")
    expect(questions.map((q) => q.label)).toEqual([
      "Wanna play a game?",
      "How many people work at Tally?",
      "How many submissions does Tally process per month?",
      "Where was Tally founded?",
    ])
  })

  test("takes a question's label from the TITLE block that precedes it", () => {
    // The TITLE block sits in its own group, NOT the question's — grouping alone
    // would have produced four unlabelled questions.
    const q = form.fields.find((f) => f.label === "Where was Tally founded?")
    expect(q?.options?.map((o) => o.label)).toEqual([
      "🇧🇪 Belgium",
      "🇫🇷 France",
      "🇺🇸 United States",
    ])
  })

  test("falls back to payload.name when a question has no TITLE block", () => {
    const q = form.fields.find((f) => f.label === "Wanna play a game?")
    expect(q?.options?.map((o) => o.label)).toEqual(["Always!", "No..."])
    expect(q?.required).toBe(false)
  })

  test("carries isRequired through from the option block", () => {
    const q = form.fields.find((f) => f.label === "How many people work at Tally?")
    expect(q?.required).toBe(true)
  })

  test("keeps headings, paragraphs and page breaks", () => {
    const types = form.fields.map((f) => f.type)
    expect(types).toContain("heading")
    expect(types).toContain("paragraph")
    expect(types.filter((t) => t === "page_break")).toHaveLength(4)
  })

  test("maps heading levels", () => {
    const h1 = form.fields.find((f) => f.label === "Hi there, wanna play a game?")
    expect(h1?.type).toBe("heading")
    expect(h1?.config?.headingLevel).toBe("h1")
    // H3 folds to h2 — we render two levels, and losing the text would be worse.
    const h3 = form.fields.find((f) => f.label === "No time for games? Got it!")
    expect(h3?.config?.headingLevel).toBe("h2")
  })

  test("reports calculated fields instead of dropping them silently", () => {
    expect(skipped.map((s) => s.type)).toContain("Calculated fields")
  })

  test("drops conditional logic without reporting it as a loss", () => {
    // 6 CONDITIONAL_LOGIC blocks in this form. They are page jumps, which have
    // no target in our show/hide model — but they are not content, so listing
    // them as "skipped" would read as if questions went missing.
    expect(skipped.some((s) => s.type === "CONDITIONAL_LOGIC")).toBe(false)
  })

  test("gives every field and option a distinct id", () => {
    const ids = form.fields.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    const optionIds = form.fields.flatMap((f) => f.options?.map((o) => o.id) ?? [])
    expect(new Set(optionIds).size).toBe(optionIds.length)
  })

  test("never emits a field type the editor cannot render", () => {
    const renderable = new Set([
      "short_text", "long_text", "email", "phone", "url", "multiple_choice",
      "dropdown", "multi_select", "checkboxes", "yes_no", "rating", "scale",
      "nps", "date", "time", "file_upload", "heading", "paragraph", "image",
      "page_break",
    ])
    for (const f of form.fields) expect(renderable.has(f.type)).toBe(true)
  })
})

describe("parseTallyBlocks — type and config mapping", () => {
  test("maps the input types we support", () => {
    const blocks: TallyBlock[] = [
      block({ type: "INPUT_TEXT", groupType: "INPUT_TEXT", groupUuid: "a" }),
      block({ type: "TEXTAREA", groupType: "TEXTAREA", groupUuid: "b" }),
      block({ type: "INPUT_EMAIL", groupType: "INPUT_EMAIL", groupUuid: "c" }),
      block({ type: "INPUT_LINK", groupType: "INPUT_LINK", groupUuid: "d" }),
      block({ type: "INPUT_PHONE_NUMBER", groupType: "INPUT_PHONE_NUMBER", groupUuid: "e" }),
      block({ type: "INPUT_DATE", groupType: "INPUT_DATE", groupUuid: "f" }),
      block({ type: "INPUT_TIME", groupType: "INPUT_TIME", groupUuid: "g" }),
      block({ type: "FILE_UPLOAD", groupType: "FILE_UPLOAD", groupUuid: "h" }),
    ]
    expect(parseTallyBlocks(blocks).form.fields.map((f) => f.type)).toEqual([
      "short_text", "long_text", "email", "url", "phone", "date", "time", "file_upload",
    ])
  })

  test("lands INPUT_NUMBER on short_text — we have no numeric type", () => {
    const blocks = [block({ type: "INPUT_NUMBER", groupType: "INPUT_NUMBER" })]
    expect(parseTallyBlocks(blocks).form.fields[0].type).toBe("short_text")
  })

  test("reads scale bounds and labels", () => {
    const blocks = [
      block({
        type: "LINEAR_SCALE",
        groupType: "LINEAR_SCALE",
        payload: {
          name: "How likely?", start: 1, end: 10, step: 1,
          hasLeftLabel: true, leftLabel: "Never",
          hasRightLabel: true, rightLabel: "Always",
        },
      }),
    ]
    const f = parseTallyBlocks(blocks).form.fields[0]
    expect(f.type).toBe("scale")
    expect(f.config).toMatchObject({ min: 1, max: 10, step: 1, minLabel: "Never", maxLabel: "Always" })
  })

  test("reads rating stars and file limits", () => {
    const rating = parseTallyBlocks([
      block({ type: "RATING", groupType: "RATING", payload: { name: "Rate us", stars: 10 } }),
    ]).form.fields[0]
    expect(rating.config?.ratingMax).toBe(10)

    const upload = parseTallyBlocks([
      block({
        type: "FILE_UPLOAD",
        groupType: "FILE_UPLOAD",
        payload: {
          name: "CV", allowedFiles: ["PDF", "DOCX"],
          hasMaxFileSize: true, maxFileSize: 10, hasMaxFiles: true, maxFiles: 3,
        },
      }),
    ]).form.fields[0]
    expect(upload.config).toMatchObject({
      allowedFileTypes: ["PDF", "DOCX"], maxFileSizeMb: 10, maxFiles: 3,
    })
  })

  test("ignores a limit whose hasX guard is false", () => {
    // Tally leaves the previous number in place when the toggle is off, so
    // reading it unguarded imports a limit the form does not enforce.
    const blocks = [
      block({
        type: "INPUT_TEXT",
        groupType: "INPUT_TEXT",
        payload: { name: "Name", hasMaxCharacters: false, maxCharacters: 40 },
      }),
    ]
    expect(parseTallyBlocks(blocks).form.fields[0].config?.maxLength).toBeUndefined()
  })

  test("turns the Other choice into allowOther, not an option", () => {
    const blocks: TallyBlock[] = [
      block({ type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "g", payload: { name: "Pick", text: "A" } }),
      block({ type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "g", payload: { text: "B" } }),
      block({ type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "g", payload: { text: "Other", isOtherOption: true } }),
    ]
    const f = parseTallyBlocks(blocks).form.fields[0]
    expect(f.options?.map((o) => o.label)).toEqual(["A", "B"])
    expect(f.config?.allowOther).toBe(true)
  })

  test("keeps two adjacent choice questions apart", () => {
    // Both are MULTIPLE_CHOICE with no TITLE between them; only groupUuid says
    // where one ends. Getting this wrong merges them into one six-option field.
    const blocks: TallyBlock[] = [
      block({ type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "one", payload: { name: "First", text: "A" } }),
      block({ type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "one", payload: { text: "B" } }),
      block({ type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "two", payload: { name: "Second", text: "C" } }),
    ]
    const fields = parseTallyBlocks(blocks).form.fields
    expect(fields).toHaveLength(2)
    expect(fields[0].options).toHaveLength(2)
    expect(fields[1].label).toBe("Second")
  })

  test("takes a LABEL block as the question's description", () => {
    const blocks: TallyBlock[] = [
      block({ type: "TITLE", groupType: "QUESTION", payload: { safeHTMLSchema: [["Email"]] } }),
      block({ type: "LABEL", groupType: "QUESTION", payload: { safeHTMLSchema: [["We never share it"]] } }),
      block({ type: "INPUT_EMAIL", groupType: "INPUT_EMAIL", payload: { isRequired: true, placeholder: "you@work.com" } }),
    ]
    const f = parseTallyBlocks(blocks).form.fields[0]
    expect(f).toMatchObject({
      type: "email", label: "Email", description: "We never share it",
      placeholder: "you@work.com", required: true,
    })
  })

  test("stops at the thank-you page and says why", () => {
    const blocks: TallyBlock[] = [
      block({ type: "INPUT_TEXT", groupType: "INPUT_TEXT", payload: { name: "Name" } }),
      block({ type: "PAGE_BREAK", payload: { isThankYouPage: true } }),
      block({ type: "HEADING_1", payload: { safeHTMLSchema: [["Thanks for your time!"]] } }),
    ]
    const { form, skipped } = parseTallyBlocks(blocks)
    expect(form.fields.map((f) => f.label)).toEqual(["Name"])
    expect(skipped.map((s) => s.type)).toContain("PAGE_BREAK")
  })

  test("reports an unsupported question under its own name", () => {
    const blocks: TallyBlock[] = [
      block({ type: "TITLE", groupType: "QUESTION", payload: { safeHTMLSchema: [["Sign here"]] } }),
      block({ type: "SIGNATURE", groupType: "SIGNATURE" }),
      block({ type: "PAYMENT", groupType: "PAYMENT" }),
    ]
    const { form, skipped } = parseTallyBlocks(blocks)
    expect(form.fields).toHaveLength(0)
    expect(skipped).toEqual([
      { type: "Signature", label: "Sign here" },
      { type: "Payment", label: "Payment" },
    ])
  })

  test("reports a block type it has never seen rather than dropping it", () => {
    const { skipped } = parseTallyBlocks([block({ type: "SOMETHING_NEW" })])
    expect(skipped).toEqual([{ type: "SOMETHING_NEW", label: "SOMETHING_NEW" }])
  })

  test("drops empty headings and paragraphs", () => {
    const blocks = [
      block({ type: "HEADING_1", payload: { safeHTMLSchema: [[""]] } }),
      block({ type: "TEXT", payload: { safeHTMLSchema: [["  "]] } }),
    ]
    expect(parseTallyBlocks(blocks).form.fields).toHaveLength(0)
  })

  test("names an untitled form rather than saving an empty title", () => {
    expect(parseTallyBlocks([]).form.title).toBe("Imported form")
  })
})

describe("parseTallySettings", () => {
  test("carries the progress bar and redirect across", () => {
    expect(
      parseTallySettings({ hasProgressBar: true, redirectOnCompletion: "https://x.test/thanks" }),
    ).toEqual({ showProgressBar: true, redirectUrl: "https://x.test/thanks" })
  })

  test("reads the real form's settings without inventing keys", () => {
    expect(parseTallySettings(REAL.settings)).toEqual({ showProgressBar: false })
  })

  test("survives junk", () => {
    expect(parseTallySettings(null)).toEqual({})
    expect(parseTallySettings("nope")).toEqual({})
  })
})
