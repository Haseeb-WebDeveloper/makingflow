import { describe, expect, it } from "vitest"

import { markdownToPlainText, toInlineMarkdown } from "@/lib/markdown"

/**
 * Question labels are authored as inline markdown (bold/italic/link) but many
 * consumers need the bare words: CSV headers, the stored `answers.question`
 * snapshot, Sheets/Notion column names, AI prompts, validation messages, and
 * the builder's own chrome (logic editor, analytics cards). Those must never
 * show `**asterisks**`, so this conversion is the single chokepoint they share.
 */
describe("markdownToPlainText", () => {
  it("returns plain text unchanged", () => {
    expect(markdownToPlainText("What is your name?")).toBe("What is your name?")
  })

  it("is empty for empty input", () => {
    expect(markdownToPlainText("")).toBe("")
  })

  it("strips bold and italic, keeping the words", () => {
    expect(markdownToPlainText("How **urgent** is this _really_?")).toBe(
      "How urgent is this really?",
    )
  })

  it("keeps link text and drops the URL", () => {
    expect(markdownToPlainText("Accept our [terms](https://example.com/terms)?")).toBe(
      "Accept our terms?",
    )
  })

  it("collapses a hard break to a single space", () => {
    // Two trailing spaces is how the editor serializes Enter (a <br>).
    expect(markdownToPlainText("First line  \nSecond line")).toBe("First line Second line")
  })

  it("collapses paragraphs to a single line", () => {
    expect(markdownToPlainText("One\n\nTwo")).toBe("One Two")
  })

  it("decodes entities rather than leaking them", () => {
    expect(markdownToPlainText("Tom & Jerry")).toBe("Tom & Jerry")
    expect(markdownToPlainText('Say "hi"')).toBe('Say "hi"')
    expect(markdownToPlainText("Ages 5 < 18")).toBe("Ages 5 < 18")
  })

  it("keeps text that merely looks like markup", () => {
    // A lone asterisk is not emphasis; it must survive.
    expect(markdownToPlainText("Required *")).toBe("Required *")
  })

  it("unwraps nested marks", () => {
    expect(markdownToPlainText("**[bold link](https://a.test)**")).toBe("bold link")
  })

  it("keeps a legacy label's literal HTML-looking text, as plain React did", () => {
    expect(markdownToPlainText("<b>Legacy</b> label")).toBe("<b>Legacy</b> label")
    expect(markdownToPlainText("Age <b> 18")).toBe("Age <b> 18")
  })

  it("normalizes runaway whitespace", () => {
    expect(markdownToPlainText("  spaced   out  ")).toBe("spaced out")
  })
})

/**
 * Every label written before questions became rich text is plain prose that is
 * now parsed as markdown. Numbered questions ("1. Full Name") are the common
 * case and the dangerous one: parsed as a list, the number is consumed and
 * every question on the form renumbers to "1.". These are drawn from labels
 * that actually exist in the database.
 */
describe("markdownToPlainText on legacy plain-text labels", () => {
  const cases: [string, string][] = [
    ["1. Full Name", "1. Full Name"],
    ["2. Email Address", "2. Email Address"],
    ["9. Anything Relevant We Should Know? (Optional)", "9. Anything Relevant We Should Know? (Optional)"],
    ["1) Identify the correct sentence.", "1) Identify the correct sentence."],
    ["Include:\n- tools used\n- your role", "Include: - tools used - your role"],
    ["Consider:\n\t1.\tFigmenta.com is our site", "Consider: 1. Figmenta.com is our site"],
    ["# Not a heading", "# Not a heading"],
    ["> Not a quote", "> Not a quote"],
    ["Question 4:\nArrange the steps:\n1)  Evaluate.\n2) Define.", "Question 4: Arrange the steps: 1) Evaluate. 2) Define."],
  ]
  for (const [input, expected] of cases) {
    it(`keeps ${JSON.stringify(input.slice(0, 32))}`, () => {
      expect(markdownToPlainText(input)).toBe(expected)
    })
  }
})

describe("toInlineMarkdown", () => {
  it("is idempotent", () => {
    const once = toInlineMarkdown("1. Full Name")
    expect(toInlineMarkdown(once)).toBe(once)
  })

  it("leaves inline marks alone", () => {
    expect(toInlineMarkdown("How **urgent** is [this](https://a.test)?")).toBe(
      "How **urgent** is [this](https://a.test)?",
    )
  })

  it("does not escape bold that merely starts the line", () => {
    // "**x**" opens no block — only "* x" (marker + space) does.
    expect(toInlineMarkdown("**Email**")).toBe("**Email**")
  })

  it("preserves a hard break", () => {
    expect(toInlineMarkdown("One  \nTwo")).toBe("One  \nTwo")
  })

  it("unescapes the form the editor saves back", () => {
    // Turndown re-escapes on save, so this is what is actually stored after an
    // edit to a legacy numbered question.
    expect(markdownToPlainText("1\\. Full Name")).toBe("1. Full Name")
    expect(markdownToPlainText("**1\\. Full Name**")).toBe("1. Full Name")
    expect(toInlineMarkdown("1\\. Full Name")).toBe("1\\. Full Name")
  })
})
