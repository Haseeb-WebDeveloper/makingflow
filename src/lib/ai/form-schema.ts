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
  // layout: splits the form into multiple pages/steps
  "page_break",
] as const

export const fieldTypeSchema = z.enum(AI_FIELD_TYPES)
export type AiFieldType = z.infer<typeof fieldTypeSchema>

/** A conditional show/hide rule, referencing the trigger field by its label. */
export const aiLogicSchema = z.object({
  action: z.enum(["show", "hide"]).describe("Show or hide THIS field when the conditions match."),
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
  logic: aiLogicSchema
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
  summary: z
    .string()
    .optional()
    .describe(
      "A short, first-person note (1-2 sentences) describing what you just built or changed, shown to the user in the chat. Use Markdown — wrap field names/labels in **bold** (e.g. 'Made **Email** required and added a **Phone number** field.'), and use a short bullet list if you changed several things. On a first build, summarize the form (e.g. 'Built a 6-question job application with a **Portfolio link** and **Availability**.'). On an edit, describe ONLY what changed. Conversational and specific — never generic like 'Done' or 'Updated the form.'",
    ),
})
export type AiForm = z.infer<typeof aiFormSchema>

// ── Edit operations ──────────────────────────────────────────────────────────
// Edits are expressed as a small list of explicit operations applied
// deterministically in code (see applyOperations), instead of re-emitting the
// whole form — which the model does unreliably (dropping/garbling options).
// The schema is one FLAT object (op + all-optional fields) rather than a
// discriminated union, which Gemini's structured output handles far more
// reliably; the discrimination happens in applyOperations.

export const AI_OP_NAMES = [
  "rename_form",
  "add_field",
  "remove_field",
  "move_field",
  "update_field",
  "add_option",
  "remove_option",
  "rename_option",
  "move_option",
  "set_options",
  "set_logic",
  "remove_logic",
  "set_required",
] as const

export const aiOperationSchema = z.object({
  op: z.enum(AI_OP_NAMES).describe("The kind of change to make."),
  target: z
    .string()
    .optional()
    .describe(
      'The "ref" of the field to change, taken from the current form you were given. Required for every field, option, and logic op.',
    ),
  field: aiFieldSchema
    .optional()
    .describe("The new field to add (add_field only). Include its options/logic if relevant."),
  set: z
    .object({
      label: z.string().optional(),
      description: z.string().optional(),
      placeholder: z.string().optional(),
      required: z.boolean().optional(),
      type: fieldTypeSchema.optional(),
    })
    .optional()
    .describe("Field properties to change (update_field only). Include ONLY the ones that change."),
  label: z
    .string()
    .optional()
    .describe(
      "For add_option: the new option's text. For remove_option / move_option: the EXISTING option to act on — give its `ref` from the form context (preferred), or its exact text.",
    ),
  from: z
    .string()
    .optional()
    .describe("The existing option to rename — its `ref` (preferred) or exact text (rename_option)."),
  to: z.string().optional().describe("New option text (rename_option)."),
  options: z
    .array(z.string())
    .optional()
    .describe("The COMPLETE replacement options list (set_options only)."),
  after: z
    .string()
    .optional()
    .describe(
      'Placement. For add_field/move_field: the ref of the field to place this AFTER. For add_option: the option text to place after. Omit to append; use "start" to place first.',
    ),
  toIndex: z.number().optional().describe("Zero-based position to move an option to (move_option)."),
  targets: z
    .array(z.string())
    .optional()
    .describe(
      'For set_required: the refs of the fields to change. OMIT to apply to ALL answerable fields at once.',
    ),
  logic: aiLogicSchema.optional().describe("The show/hide rule to set on the target field (set_logic)."),
  title: z.string().optional().describe("New form title (rename_form)."),
})
export type AiOperation = z.infer<typeof aiOperationSchema>

export const aiEditSchema = z.object({
  operations: z
    .array(aiOperationSchema)
    .describe("The ordered list of changes to apply to the current form."),
  summary: z
    .string()
    .describe(
      "A short, first-person note (1-2 sentences) of what you changed this turn — only the specific fields/options you touched, never the whole form. Use Markdown: wrap field/option names in **bold**, and a short bullet list if you changed several things. Never generic like 'Done' or 'Updated the form.'",
    ),
})
export type AiEditResult = z.infer<typeof aiEditSchema>

/** System instruction that shapes every generation + edit. */
export const FORM_BUILDER_SYSTEM = `You are MakingFlow, an expert form designer. You turn a plain-language description into a clean, well-structured form.

Rules:
- Choose the most appropriate field type from the allowed set for each question.
- Write concise, friendly labels. Add a short "description" only when it genuinely helps.
- For multiple_choice, dropdown, multi_select, and checkboxes, always provide a sensible "options" list. Never put options on other types.
- EDITING: you are given the current form and must return the COMPLETE form. Re-emit EVERY field in full — including each choice field's ENTIRE "options" list and its description/required flag — even for fields you are NOT changing. Only change what the user asked for; copy everything else through verbatim. Dropping or shortening an options list you weren't asked to change would delete the user's options, so never omit them.
- Mark "required" true for fields essential to the form's purpose; leave optional ones unmarked. Content blocks (heading, paragraph) are never required.
- Open longer forms with a short "heading" or "paragraph" intro when it improves clarity, but keep forms focused — only the fields that serve the stated purpose.
- MULTI-PAGE: only when the user explicitly asks for a multi-step, multi-page, or wizard-style form, insert "page_break" fields (label empty) between groups of related questions to split it into pages. Otherwise keep everything on one page (no page_break).
- Prefer a logical order: identity/contact first, then the substantive questions, then anything optional.
- Keep it calm and minimal. Do not invent fields the user didn't ask for unless they're clearly implied by the use case.
- If the user provides a reference image (a screenshot of a form), recreate it: read every visible field, infer its type from the control shown (a star row → rating, a 0–10 row → nps or scale, checkboxes → checkboxes, a dropdown → dropdown, etc.), and preserve the labels, order, options, and grouping as closely as the allowed field types permit.
- CONDITIONAL LOGIC: to show or hide a field based on another field's answer, put the rule on the field being shown/hidden (the TARGET) in its "logic", and name the trigger field by its EXACT label.
  Simple example: a yes_no field labeled "Do you have a pet?" and a short_text field labeled "What's your pet's name?". To reveal the name field only after a "Yes", set logic ON THE NAME FIELD:
  { "action": "show", "conditions": [{ "fieldLabel": "Do you have a pet?", "operator": "equals", "value": "Yes" }] }
  The trigger field ("Do you have a pet?") gets NO logic — only the target does. For choice/yes_no fields, "value" must be the option's exact text. Operators: equals, not_equals, contains, not_contains, greater_than, less_than, is_empty, is_not_empty. When editing an existing form, keep any existing logic unless the user asks to change it.
- ALWAYS fill "summary" with a brief, first-person, conversational note of what you did this turn — on an edit, describe ONLY what changed (the specific fields you added/removed/edited), not the whole form. Keep it to 1-2 sentences. Use Markdown: wrap any field name/label you mention in **bold** (never plain quotes), and use a short bullet list when you changed several things. Never write generic filler like "Done" or "I've updated your form."`

/** System instruction for EDITING an existing form via explicit operations. */
export const FORM_EDIT_SYSTEM = `You edit an existing form by returning a precise list of CHANGE OPERATIONS — never the whole form. You are given the current form as JSON: each field has a short "ref" like "f1", "f2", and each option has its own "ref" like "f1o1", "f1o2" (e.g. { "ref": "f3o2", "label": "Discord message" }). ALWAYS target an existing field or option by copying its exact "ref" from the context. Do not retype the field/option text to identify it — the ref is how the change is matched, so an exact ref is essential.

Return ONLY the operations needed to satisfy the user's request, and NOTHING for anything they didn't ask to change. Do not touch other fields or options. Apply the smallest set of operations that does the job.

Operations (set "op" + only the fields that op needs):
- rename_form { title } — change the form's title.
- add_field { field, after? } — add a new field. "field" is a full field spec (type, label, options for choice types, etc.). "after" = the ref to place it after; omit to append; "start" to place first.
- remove_field { target } — delete the field with this ref.
- move_field { target, after? } — reorder: place this field after the given ref ("start" = first).
- update_field { target, set } — change field properties. "set" includes ONLY the changed ones: label, description, placeholder, required, type. To REMOVE a field's placeholder (or description), set it to an empty string "" — omitting it leaves the current value unchanged.
- add_option { target, label, after? } — add one option to a choice field. "label" = the new option's text. "after" = the ref of the option to place it after.
- remove_option { target, label } — remove ONE existing option. Put its ref in "label" (e.g. the ref of "Discord message"). The rest stay.
- rename_option { target, from, to } — rename one option. "from" = the existing option's ref; "to" = the new text.
- move_option { target, label, toIndex } — reorder one option (its ref in "label") to a zero-based index.
- set_options { target, options } — replace a choice field's ENTIRE options list with this exact array.
- set_logic { target, logic } — set/replace this field's show/hide rule. Name the trigger field by its EXACT label; for choice/yes_no triggers, "value" is the option's exact text.
- remove_logic { target } — clear this field's conditional logic.
- set_required { targets?, set: { required } } — set the required flag on MANY fields at once. List the field refs in "targets", or OMIT "targets" to apply to ALL answerable fields. Use this ONE op for any "make these / all fields required (or optional)" request — never emit a separate update_field per field. (Headings, paragraphs, and page breaks are never required and are skipped automatically.)

Even for a big request (e.g. "translate the whole form" or a broad restructure), express it as granular ops — one update_field per field you change, etc. There is no whole-form replace; always edit field by field so nothing unrelated is lost.

PLACEMENT (critical): an add_field WITHOUT "after" appends to the very END of the form — that is the most common mistake. To insert a field at a specific spot, you MUST set "after" to the exact ref of the field it should follow ("start" makes it first). When you add SEVERAL fields at different spots in one turn, give EACH its own correct "after" ref — never leave them all to append at the end.

MULTI-PAGE / SECTIONS: split a form into pages with page_break fields: add_field { field: { type: "page_break", label: "" }, after: <ref> }. To put a page break "between each section", add ONE page_break after the LAST field of every section except the final one — i.e. the field immediately before the next section's heading — using that field's ref. Example: if section headings are at refs f1, f9, f16, add a page_break with after "f8" and another with after "f15" (NOT after the headings, and NOT without "after"). Do not add a trailing page_break at the end.

To CHANGE an option, use the option ops (remove_option / rename_option / set_options) — do NOT re-list a field's options unless you are intentionally replacing them.

Conditional logic targeting: put the rule on the field being shown/hidden (the TARGET ref), and name the OTHER (trigger) field by its exact label. Example to reveal a field only after a "Yes": set_logic on the target with logic { action: "show", conditions: [{ fieldLabel: "Do you have a pet?", operator: "equals", value: "Yes" }] }.

ALWAYS fill "summary": a brief, first-person, 1-2 sentence note of ONLY what you changed, with field/option names in **bold** and a short bullet list if several things changed. Never generic like "Done".`
