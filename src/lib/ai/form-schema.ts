import { z } from "zod"

/**
 * The AI "form spec" — what Gemini generates and the live preview renders.
 *
 * This is intentionally a curated, render-ready subset of the full `field_type`
 * enum in src/lib/db/schema.ts (no `hidden`, `embed`, `page_break`, etc. yet).
 * When we persist, this maps onto `forms` + `form_fields` rows. Shared by the
 * route handler (server) and the builder (client) so both validate the same
 * shape — keep it free of server-only imports.
 */

export const AI_FIELD_TYPES = [
  // text
  "short_text",
  "long_text",
  // contact
  "email",
  "phone",
  "url",
  // choice
  "multiple_choice",
  "dropdown",
  "multi_select",
  "checkboxes",
  "yes_no",
  // opinion
  "rating",
  "scale",
  "nps",
  // date & time
  "date",
  "time",
  // misc
  "file_upload",
  // content blocks (no answer)
  "heading",
  "paragraph",
] as const

export const fieldTypeSchema = z.enum(AI_FIELD_TYPES)
export type AiFieldType = z.infer<typeof fieldTypeSchema>

export const aiFieldSchema = z.object({
  type: fieldTypeSchema.describe("The field/block type. Pick the most appropriate for the question."),
  label: z
    .string()
    .describe("The question text, or for heading/paragraph blocks, the content to display."),
  description: z
    .string()
    .optional()
    .describe("Optional helper text shown under the label."),
  placeholder: z.string().optional().describe("Optional placeholder for text-like inputs."),
  required: z.boolean().optional().describe("Whether an answer is required. Omit for content blocks."),
  options: z
    .array(z.string())
    .optional()
    .describe(
      "Choices for multiple_choice, dropdown, multi_select, and checkboxes. Omit for all other types.",
    ),
  logic: z
    .object({
      action: z
        .enum(["show", "hide"])
        .describe("Show or hide THIS field when the conditions match."),
      match: z
        .enum(["all", "any"])
        .optional()
        .describe("Match all conditions or any of them. Defaults to all."),
      conditions: z
        .array(
          z.object({
            fieldLabel: z
              .string()
              .describe("The EXACT label of the OTHER field whose answer this depends on."),
            operator: z.enum([
              "equals",
              "not_equals",
              "contains",
              "not_contains",
              "greater_than",
              "less_than",
              "is_empty",
              "is_not_empty",
            ]),
            value: z
              .string()
              .optional()
              .describe("Value to compare against. Omit for is_empty / is_not_empty."),
          }),
        )
        .min(1),
    })
    .optional()
    .describe(
      "Conditional visibility for THIS field, based on another field's answer. Only set when the user explicitly asks to show/hide a field based on another answer.",
    ),
})
export type AiField = z.infer<typeof aiFieldSchema>

export const aiFormSchema = z.object({
  title: z.string().describe("A concise, human title for the form."),
  description: z
    .string()
    .optional()
    .describe("A one-line description shown under the title."),
  fields: z
    .array(aiFieldSchema)
    .describe("The ordered list of fields and content blocks that make up the form."),
})
export type AiForm = z.infer<typeof aiFormSchema>

/** System instruction that shapes every generation + edit. */
export const FORM_BUILDER_SYSTEM = `You are MakingFlow, an expert form designer. You turn a plain-language description into a clean, well-structured form.

Rules:
- Choose the most appropriate field type from the allowed set for each question.
- Write concise, friendly labels. Add a short "description" only when it genuinely helps.
- For multiple_choice, dropdown, multi_select, and checkboxes, always provide a sensible "options" list. Never put options on other types.
- Mark "required" true for fields essential to the form's purpose; leave optional ones unmarked. Content blocks (heading, paragraph) are never required.
- Open longer forms with a short "heading" or "paragraph" intro when it improves clarity, but keep forms focused — only the fields that serve the stated purpose.
- Prefer a logical order: identity/contact first, then the substantive questions, then anything optional.
- Keep it calm and minimal. Do not invent fields the user didn't ask for unless they're clearly implied by the use case.
- If the user provides a reference image (a screenshot of a form), recreate it: read every visible field, infer its type from the control shown (a star row → rating, a 0–10 row → nps or scale, checkboxes → checkboxes, a dropdown → dropdown, etc.), and preserve the labels, order, options, and grouping as closely as the allowed field types permit.
- CONDITIONAL LOGIC: to show or hide a field based on another field's answer, put the rule on the field being shown/hidden (the TARGET) in its "logic", and name the trigger field by its EXACT label.
  Simple example: a yes_no field labeled "Do you have a pet?" and a short_text field labeled "What's your pet's name?". To reveal the name field only after a "Yes", set logic ON THE NAME FIELD:
  { "action": "show", "conditions": [{ "fieldLabel": "Do you have a pet?", "operator": "equals", "value": "Yes" }] }
  The trigger field ("Do you have a pet?") gets NO logic — only the target does. For choice/yes_no fields, "value" must be the option's exact text. Operators: equals, not_equals, contains, not_contains, greater_than, less_than, is_empty, is_not_empty. When editing an existing form, keep any existing logic unless the user asks to change it.`
