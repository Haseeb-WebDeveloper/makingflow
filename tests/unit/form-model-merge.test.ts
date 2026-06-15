import { describe, expect, test } from "vitest"
import { mergeAiIntoEditor, type EditorForm } from "@/lib/builder/form-model"
import type { AiForm } from "@/lib/ai/form-schema"

// An existing form with a checkbox field that has options + stable ids.
const prev: EditorForm = {
  title: "Survey",
  fields: [
    {
      id: "f-tech",
      type: "checkboxes",
      label: "What are your preferred frontend technologies?",
      required: true,
      options: [
        { id: "o1", label: "React" },
        { id: "o2", label: "Vue" },
        { id: "o3", label: "Other" },
      ],
    },
  ],
}

describe("mergeAiIntoEditor — preserve on omission", () => {
  test("keeps options when the AI drops them on an unchanged choice field", () => {
    // The reported bug: asked to add a conditional follow-up, the model re-emits
    // the checkbox field but OMITS its options array.
    const ai: AiForm = {
      title: "Survey",
      fields: [
        {
          type: "checkboxes",
          label: "What are your preferred frontend technologies?",
          required: true,
          // options omitted
        },
        {
          type: "short_text",
          label: "Which other technology?",
          logic: {
            action: "show",
            conditions: [
              {
                fieldLabel: "What are your preferred frontend technologies?",
                operator: "contains",
                value: "Other",
              },
            ],
          },
        },
      ],
    }
    const out = mergeAiIntoEditor(ai, prev)
    const tech = out.fields.find((f) => f.label.startsWith("What are your"))!
    // Options (and their stable ids) survive the edit.
    expect(tech.options?.map((o) => o.label)).toEqual(["React", "Vue", "Other"])
    expect(tech.options?.map((o) => o.id)).toEqual(["o1", "o2", "o3"])
    // The requested conditional field was added.
    expect(out.fields.some((f) => f.label === "Which other technology?")).toBe(true)
  })

  test("applies new options when the AI does send them (an intentional edit wins)", () => {
    const ai: AiForm = {
      title: "Survey",
      fields: [
        {
          type: "checkboxes",
          label: "What are your preferred frontend technologies?",
          required: true,
          options: ["React", "Svelte"],
        },
      ],
    }
    const out = mergeAiIntoEditor(ai, prev)
    expect(out.fields[0].options?.map((o) => o.label)).toEqual(["React", "Svelte"])
    // Reuses the id for a kept option, mints a new one for the added option.
    expect(out.fields[0].options?.find((o) => o.label === "React")?.id).toBe("o1")
  })

  test("drops options when the field type changes away from a choice type", () => {
    const ai: AiForm = {
      title: "Survey",
      fields: [
        { type: "short_text", label: "What are your preferred frontend technologies?", required: true },
      ],
    }
    const out = mergeAiIntoEditor(ai, prev)
    expect(out.fields[0].options).toBeUndefined()
  })

  test("keeps description/required when the AI omits them", () => {
    const withHelp: EditorForm = {
      title: "Survey",
      fields: [
        {
          id: "f1",
          type: "short_text",
          label: "Full name",
          description: "As it appears on your ID",
          required: true,
        },
      ],
    }
    const ai: AiForm = {
      title: "Survey",
      fields: [{ type: "short_text", label: "Full name" }], // description + required omitted
    }
    const out = mergeAiIntoEditor(ai, withHelp)
    expect(out.fields[0].description).toBe("As it appears on your ID")
    expect(out.fields[0].required).toBe(true)
  })
})
