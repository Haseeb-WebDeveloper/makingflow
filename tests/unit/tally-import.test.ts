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

  test("never reports a logic block as a lost block", () => {
    // A rule is not content. Whether it translates or not, listing it under
    // "we couldn't bring these over" would read as if questions went missing —
    // the untranslatable parts are reported by what they DO, not by block type.
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

  test("reads allowMultiple as a multi-select, not a single choice", () => {
    // Tally has no separate multi-select type. Reading only the block type turns
    // a question that takes several answers into one that takes one — and the
    // answers still import, so nothing looks wrong until a respondent tries.
    const blocks: TallyBlock[] = [
      block({
        type: "MULTIPLE_CHOICE_OPTION",
        groupType: "MULTIPLE_CHOICE",
        groupUuid: "g1",
        payload: { name: "Skills", allowMultiple: true, text: "Video editing" },
      }),
      block({
        type: "MULTIPLE_CHOICE_OPTION",
        groupType: "MULTIPLE_CHOICE",
        groupUuid: "g1",
        payload: { text: "Motion design" },
      }),
    ]
    const f = parseTallyBlocks(blocks).form.fields[0]
    expect(f.type).toBe("multi_select")
    expect(f.options?.map((o) => o.label)).toEqual(["Video editing", "Motion design"])
  })

  test("stays a single choice without allowMultiple", () => {
    const blocks = [
      block({
        type: "MULTIPLE_CHOICE_OPTION",
        groupType: "MULTIPLE_CHOICE",
        payload: { name: "Pick one", text: "Yes" },
      }),
    ]
    expect(parseTallyBlocks(blocks).form.fields[0].type).toBe("multiple_choice")
  })

  test("finds an image's url where Tally actually keeps it", () => {
    // It lives in `images[]`. Reading `url`/`src` — which every other block's
    // shape suggests — yields an image block with no picture in it.
    const blocks = [
      block({
        type: "IMAGE",
        payload: { images: [{ name: "logo.png", url: "https://storage.tally.so/x/logo.png" }] },
      }),
    ]
    expect(parseTallyBlocks(blocks).form.fields[0].config?.imageUrl).toBe(
      "https://storage.tally.so/x/logo.png",
    )
  })

  test("takes the form logo off the FORM_TITLE block", () => {
    const blocks = [
      block({ type: "FORM_TITLE", payload: { title: "Apply", logo: "https://x.test/logo.jpg" } }),
      block({ type: "INPUT_TEXT", groupType: "INPUT_TEXT", payload: { name: "Name" } }),
    ]
    expect(parseTallyBlocks(blocks).form.theme?.logoUrl).toBe("https://x.test/logo.jpg")
  })

  test("imports a hidden question but never as required", () => {
    // A question the respondent cannot see, which they must answer to submit,
    // is a form that cannot be submitted.
    const blocks = [
      block({
        type: "TEXTAREA",
        groupType: "TEXTAREA",
        payload: { name: "Internal notes", isRequired: true, isHidden: true },
      }),
    ]
    const f = parseTallyBlocks(blocks).form.fields[0]
    expect(f.label).toBe("Internal notes")
    expect(f.required).toBe(false)
  })

  test("gives the same field the same id on every parse when seeded", () => {
    // Field ids are what saveAiForm upserts on and answers point at. Random ids
    // on a re-import would soft-delete every field and orphan its answers.
    const blocks = [
      block({ type: "INPUT_TEXT", groupType: "INPUT_TEXT", groupUuid: "g1", payload: { name: "Name" } }),
    ]
    const a = parseTallyBlocks(blocks, "F", "form123").form.fields[0].id
    const b = parseTallyBlocks(blocks, "F", "form123").form.fields[0].id
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    // A different form must not collide with it.
    expect(parseTallyBlocks(blocks, "F", "form999").form.fields[0].id).not.toBe(a)
    // Unseeded stays random, so the public-link path is unchanged.
    expect(parseTallyBlocks(blocks).form.fields[0].id).not.toBe(a)
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

  test("moves the thank-you page to the success page, not into the form", () => {
    // Those blocks are a confirmation message. Left in the field list they read
    // as questions asked after the submit button.
    const blocks: TallyBlock[] = [
      block({ type: "INPUT_TEXT", groupType: "INPUT_TEXT", payload: { name: "Name" } }),
      block({ type: "PAGE_BREAK", payload: { isThankYouPage: true } }),
      block({ type: "HEADING_1", payload: { safeHTMLSchema: [["Thanks for your time!"]] } }),
      block({ type: "TEXT", payload: { safeHTMLSchema: [["We'll be in touch."]] } }),
    ]
    const { form } = parseTallyBlocks(blocks)
    expect(form.fields.map((f) => f.label)).toEqual(["Name"])
    expect(form.settings?.thankYouMessage).toBe("Thanks for your time!")
    expect(form.settings?.successBody).toBe("<p>We'll be in touch.</p>")
  })

  test("keeps links in the thank-you page and refuses dangerous ones", () => {
    const blocks: TallyBlock[] = [
      block({ type: "INPUT_TEXT", groupType: "INPUT_TEXT", payload: { name: "Name" } }),
      block({ type: "PAGE_BREAK", payload: { isThankYouPage: true } }),
      block({
        type: "TEXT",
        payload: { safeHTMLSchema: [["byfigmenta", [["href", "https://instagram.com/x"]]]] },
      }),
      block({
        type: "TEXT",
        payload: { safeHTMLSchema: [["click", [["href", "javascript:alert(1)"]]]] },
      }),
    ]
    const body = parseTallyBlocks(blocks).form.settings?.successBody ?? ""
    expect(body).toContain('<a href="https://instagram.com/x"')
    // This is third-party content rendered on our own page.
    expect(body).not.toContain("javascript:")
    expect(body).toContain("<p>click</p>")
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

/**
 * Conditional logic.
 *
 * Tally's rule is a standalone object pointing AT blocks — "if X is Y, show A
 * and B" — while ours lives on the block being controlled. Importing inverts
 * the direction, and every test here is really about that inversion landing on
 * the right field.
 */
describe("parseTallyBlocks — conditional logic", () => {
  const YES = "opt-yes-uuid"
  const NO = "opt-no-uuid"

  /** A choice question: its TITLE block sits in a different group, as Tally's does. */
  const source = (): TallyBlock[] => [
    { uuid: "src-title", type: "TITLE", groupType: "QUESTION", groupUuid: "g-src-title", payload: { safeHTMLSchema: [["Do you drive?"]] } },
    { uuid: YES, type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "g-src", payload: { text: "Yes" } },
    { uuid: NO, type: "MULTIPLE_CHOICE_OPTION", groupType: "MULTIPLE_CHOICE", groupUuid: "g-src", payload: { text: "No" } },
  ]

  /** The controlled question, whose title and input are separate blocks. */
  const target = (): TallyBlock[] => [
    { uuid: "tgt-title", type: "TITLE", groupType: "QUESTION", groupUuid: "g-tgt-title", payload: { safeHTMLSchema: [["Licence number"]] } },
    { uuid: "tgt-input", type: "INPUT_TEXT", groupType: "INPUT_TEXT", groupUuid: "g-tgt", payload: {} },
  ]

  const rule = (o: {
    action: "SHOW_BLOCKS" | "HIDE_BLOCKS" | "REQUIRE_ANSWER"
    targets: string[]
    comparison?: string
    value?: unknown
    operator?: "AND" | "OR"
    conditionals?: unknown[]
  }): TallyBlock => ({
    uuid: `rule-${o.action}-${o.targets.join(",")}`,
    type: "CONDITIONAL_LOGIC",
    payload: {
      logicalOperator: o.operator ?? "AND",
      conditionals: o.conditionals ?? [
        {
          type: "SINGLE",
          payload: {
            field: { blockGroupUuid: "g-src" },
            comparison: o.comparison ?? "IS",
            value: o.value ?? YES,
          },
        },
      ],
      actions: [
        o.action === "REQUIRE_ANSWER"
          ? { type: "REQUIRE_ANSWER", payload: { requireAnswer: o.targets[0] } }
          : {
              type: o.action,
              payload:
                o.action === "SHOW_BLOCKS"
                  ? { showBlocks: o.targets }
                  : { hideBlocks: o.targets },
            },
      ],
    },
  })

  test("turns a show rule into logic on the question it points at", () => {
    const { form } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({ action: "SHOW_BLOCKS", targets: ["tgt-title", "tgt-input"] }),
    ])
    const src = form.fields.find((f) => f.label === "Do you drive?")
    const tgt = form.fields.find((f) => f.label === "Licence number")
    expect(tgt?.logic).toEqual({
      action: "show",
      match: "all",
      source: "manual",
      // The stored value is the option's LABEL, because that is what an answer
      // to this question is stored as — a uuid would never match at runtime.
      conditions: [{ fieldId: src?.id, operator: "equals", value: "Yes" }],
    })
    expect(src?.logic).toBeUndefined()
  })

  test("does not mistake one rule's two blocks for two competing rules", () => {
    // A rule names the title AND the input; both are the same question here.
    const { form, skipped } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({ action: "SHOW_BLOCKS", targets: ["tgt-title", "tgt-input"] }),
    ])
    expect(form.fields.filter((f) => f.logic)).toHaveLength(1)
    expect(skipped.some((s) => s.type === "Extra logic rule")).toBe(false)
  })

  test("maps hide rules, operators and the OR case", () => {
    const { form } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({
        action: "HIDE_BLOCKS",
        targets: ["tgt-input"],
        operator: "OR",
        comparison: "IS_EMPTY",
      }),
    ])
    const tgt = form.fields.find((f) => f.label === "Licence number")
    expect(tgt?.logic?.action).toBe("hide")
    expect(tgt?.logic?.match).toBe("any")
    // An emptiness test carries no value to compare against.
    expect(tgt?.logic?.conditions[0]).toEqual({
      fieldId: form.fields.find((f) => f.label === "Do you drive?")?.id,
      operator: "is_empty",
    })
  })

  test("keeps the first rule when two point at the same question, and says so", () => {
    const { form, skipped } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({ action: "SHOW_BLOCKS", targets: ["tgt-input"], value: YES }),
      rule({ action: "HIDE_BLOCKS", targets: ["tgt-input"], value: NO }),
    ])
    const tgt = form.fields.find((f) => f.label === "Licence number")
    // Two rules are an OR that one `match` can't express, so the second is
    // reported rather than silently overwriting the first.
    expect(tgt?.logic?.action).toBe("show")
    expect(skipped.some((s) => s.type === "Extra logic rule")).toBe(true)
  })

  test("reports a conditional-required rule instead of dropping it silently", () => {
    const { form, skipped } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({ action: "REQUIRE_ANSWER", targets: ["tgt-input"] }),
    ])
    expect(form.fields.some((f) => f.logic)).toBe(false)
    expect(skipped).toContainEqual({ type: "Conditional required", label: "Licence number" })
  })

  test("ignores a rule pointing at a block that no longer exists", () => {
    // Both REQUIRE_ANSWER rules in the account this was built against are these:
    // the block was deleted and Tally kept the rule. There is nothing to report.
    const { form, skipped } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({ action: "SHOW_BLOCKS", targets: ["deleted-long-ago"] }),
      rule({ action: "REQUIRE_ANSWER", targets: ["deleted-long-ago"] }),
    ])
    expect(form.fields.some((f) => f.logic)).toBe(false)
    expect(skipped).toEqual([])
  })

  test("drops a condition it cannot express rather than guessing", () => {
    const { form } = parseTallyBlocks([
      ...source(),
      ...target(),
      rule({
        action: "SHOW_BLOCKS",
        targets: ["tgt-input"],
        // "is any of" several answers needs an OR inside an AND group.
        comparison: "IS_ANY_OF",
        value: [YES, NO],
      }),
    ])
    expect(form.fields.find((f) => f.label === "Licence number")?.logic).toBeUndefined()
  })

  test("puts logic on a content block a rule points at", () => {
    const { form } = parseTallyBlocks([
      ...source(),
      { uuid: "note", type: "TEXT", payload: { safeHTMLSchema: [["Bring your licence."]] } },
      rule({ action: "SHOW_BLOCKS", targets: ["note"] }),
    ])
    expect(form.fields.find((f) => f.type === "paragraph")?.logic?.action).toBe("show")
  })
})
