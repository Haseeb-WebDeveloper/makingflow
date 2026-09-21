/**
 * Question text is authored as inline markdown (bold / italic / link), the same
 * convention the heading and paragraph blocks already use.
 *
 * Two halves have to hold together:
 *   1. The respondent SEES formatting — rendered through the sanitized
 *      react-markdown pipeline, never as literal asterisks.
 *   2. Everything that treats the question as DATA sees the bare words —
 *      AI prompts, logic references, exports. Those are covered here for the
 *      pure functions; the storage boundaries are exercised in the integration
 *      suite.
 */
import { afterEach, describe, expect, test } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { Field } from "@/components/forms/field-control"
import type { PublicField } from "@/lib/data/public-form"
import { buildParsePrompt, buildTurnDirective } from "@/lib/ai/conversational"
import { aiToEditor } from "@/lib/builder/form-model"

afterEach(cleanup)

function field(label: string, extra: Partial<PublicField> = {}): PublicField {
  return { id: "q1", type: "short_text", label, required: false, ...extra } as PublicField
}

function renderField(f: PublicField) {
  return render(<Field field={f} value={undefined} onChange={() => {}} />)
}

describe("question text rendering", () => {
  test("renders bold and italic instead of the markdown source", () => {
    const { container } = renderField(field("How **urgent** is this _really_?"))

    expect(container.textContent).toContain("How urgent is this really?")
    expect(container.textContent).not.toContain("**")
    expect(container.textContent).not.toContain("_really_")
    expect(container.querySelector("strong")?.textContent).toBe("urgent")
    expect(container.querySelector("em")?.textContent).toBe("really")
  })

  test("renders a link that opens safely in a new tab", () => {
    const { container } = renderField(
      field("Do you accept the [terms](https://example.com/terms)?"),
    )

    const a = container.querySelector("a")
    expect(a?.getAttribute("href")).toBe("https://example.com/terms")
    expect(a?.getAttribute("target")).toBe("_blank")
    expect(a?.getAttribute("rel")).toBe("noreferrer noopener")
    expect(a?.textContent).toBe("terms")
  })

  test("sanitizes a javascript: URL out of the href", () => {
    const { container } = renderField(field("[click](javascript:alert(1))"))

    const href = container.querySelector("a")?.getAttribute("href")
    expect(href ?? "").not.toContain("javascript:")
  })

  test("leaves a plain question exactly as written", () => {
    const { container } = renderField(field("What is your name?"))
    expect(container.textContent).toContain("What is your name?")
  })

  test("a lone asterisk in the text is not swallowed as emphasis", () => {
    const { container } = renderField(field("Rate us *"))
    expect(container.textContent).toContain("Rate us *")
  })

  test("still marks the question required, and hides the marker from AT", () => {
    const { container } = renderField(field("**Email**", { required: true }))

    const marker = screen.getByText("*")
    expect(marker.getAttribute("aria-hidden")).toBe("true")
    expect(container.querySelector("strong")?.textContent).toBe("Email")
  })

  test("the control is still named by the question text", () => {
    const { container } = renderField(field("Your **full** name"))

    const input = container.querySelector("input, textarea")
    const labelledBy = input?.getAttribute("aria-labelledby")
    expect(labelledBy).toBeTruthy()
    const named = container.querySelector(`#${labelledBy}`)
    expect(named?.textContent).toContain("Your full name")
  })
})

describe("question text as data", () => {
  test("the AI parse prompt gets the bare words", () => {
    const prompt = buildParsePrompt(
      { type: "short_text", label: "Your **full** name" },
      "Ada",
    )
    expect(prompt).toContain("Field label: Your full name")
    expect(prompt).not.toContain("**")
  })

  test("the AI turn directive gets the bare words", () => {
    const directive = buildTurnDirective({
      kind: "advance",
      previous: { label: "**Email**", reply: "a@b.test" },
      ask: { type: "short_text", label: "Your [site](https://x.test)" },
    })
    expect(directive).toContain('"Email"')
    expect(directive).toContain('"Your site"')
    expect(directive).not.toContain("**")
    expect(directive).not.toContain("https://x.test")
  })

  test("logic still resolves when the referenced question is formatted", () => {
    // The model refers to the question by the words a human reads; the stored
    // label carries markdown. Matching must ignore the markup.
    const form = aiToEditor({
      title: "T",
      fields: [
        { type: "yes_no", label: "**Subscribe?**", required: false },
        {
          type: "email",
          label: "Email",
          required: false,
          logic: {
            action: "show",
            match: "all",
            conditions: [{ fieldLabel: "Subscribe?", operator: "equals", value: "Yes" }],
          },
        },
      ],
    } as Parameters<typeof aiToEditor>[0])

    expect(form.fields[1].logic?.conditions).toHaveLength(1)
    expect(form.fields[1].logic?.conditions[0].fieldId).toBe(form.fields[0].id)
  })
})

describe("legacy plain-text questions survive being parsed as markdown", () => {
  test("a numbered question keeps its number", () => {
    const { container } = renderField(field("1. Full Name"))
    expect(container.textContent).toContain("1. Full Name")
    expect(container.querySelector("ol")).toBeNull()
    expect(container.querySelector("li")).toBeNull()
  })

  test("sibling numbered questions do not all renumber to 1", () => {
    const a = render(<Field field={field("1. Full Name")} value={undefined} onChange={() => {}} />)
    const b = render(<Field field={field("2. Email Address")} value={undefined} onChange={() => {}} />)
    expect(a.container.textContent).toContain("1. Full Name")
    expect(b.container.textContent).toContain("2. Email Address")
  })

  test("a dashed list inside a question stays literal", () => {
    const { container } = renderField(field("Include:\n- tools used\n- your role"))
    expect(container.querySelector("ul")).toBeNull()
    expect(container.textContent).toContain("- tools used")
  })

  test("a tab-indented line is not a code block", () => {
    const { container } = renderField(field("Consider:\n\t1.\tFigmenta.com"))
    expect(container.querySelector("pre")).toBeNull()
    expect(container.textContent).toContain("1.")
  })

  test("a leading # is not a heading", () => {
    const { container } = renderField(field("# Not a heading"))
    expect(container.querySelector("h1, h2, h3")).toBeNull()
    expect(container.textContent).toContain("# Not a heading")
  })
})
