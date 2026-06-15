import type { AiForm, AiField, AiFieldType } from "@/lib/ai/form-schema"
import type { FieldLogic, FieldCondition, FieldOption, FieldConfig } from "@/lib/db/schema"

/**
 * The editor's working model. Unlike the AI spec (`AiForm`), every field carries
 * a STABLE id — needed for manual editing, drag-reorder, conditional-logic
 * targets, and so the DB keeps the same field ids across saves. Options also
 * carry ids ({@link FieldOption}). Both AI edits and hand edits mutate this.
 */
export type EditorField = {
  id: string
  type: AiFieldType
  label: string
  description?: string
  placeholder?: string
  required: boolean
  options?: FieldOption[]
  logic?: FieldLogic
  // Type-specific knobs (heading level, file limits, …). The AI spec doesn't
  // carry this, so it's preserved across AI edits by `mergeAiIntoEditor`.
  config?: FieldConfig
}

export type EditorForm = {
  title: string
  fields: EditorField[]
}

export const genId = () => crypto.randomUUID()

/** The title a form starts with until the user or the AI names it. */
export const DEFAULT_FORM_TITLE = "Untitled form"

/**
 * A form with no real content yet: a fresh draft that should render the
 * "Describe your form" prompt UI (not the editor) and is safe to discard if
 * abandoned. "Blank" = no fields and a still-default (or empty) title.
 */
export function isBlankForm(form: { title: string; fields: readonly unknown[] }): boolean {
  const title = form.title.trim()
  return form.fields.length === 0 && (title === "" || title === DEFAULT_FORM_TITLE)
}

export const CHOICE_TYPES = new Set<AiFieldType>([
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "multi_select",
])
export const CONTENT_TYPES = new Set<AiFieldType>(["heading", "paragraph"])
// Layout/structural blocks that never collect an answer (page_break is a
// multi-page divider, not a question).
export const NON_ANSWER_TYPES = new Set<AiFieldType>(["heading", "paragraph", "page_break"])

export const isChoice = (t: AiFieldType) => CHOICE_TYPES.has(t)
export const isContent = (t: AiFieldType) => CONTENT_TYPES.has(t)
export const isAnswerable = (t: AiFieldType) => !NON_ANSWER_TYPES.has(t)

// ── Insert palette catalog ────────────────────────────────────────────
export type CatalogGroup = "Text" | "Choice" | "Contact" | "Rating" | "Date" | "File" | "Layout"

export type CatalogItem = {
  type: AiFieldType
  label: string
  group: CatalogGroup
  keywords?: string
  // Seed config for blocks that share a `type` but differ by config (e.g. the
  // h1/h2 heading blocks both insert a `heading` field).
  config?: FieldConfig
}

export const FIELD_CATALOG: CatalogItem[] = [
  { type: "short_text", label: "Short answer", group: "Text", keywords: "text input name" },
  { type: "long_text", label: "Long answer", group: "Text", keywords: "paragraph textarea comment" },
  { type: "multiple_choice", label: "Multiple choice", group: "Choice", keywords: "radio single option" },
  { type: "checkboxes", label: "Checkboxes", group: "Choice", keywords: "multiple select option" },
  { type: "dropdown", label: "Dropdown", group: "Choice", keywords: "select menu" },
  { type: "multi_select", label: "Multi-select", group: "Choice", keywords: "multiple tags" },
  { type: "yes_no", label: "Yes / No", group: "Choice", keywords: "boolean toggle" },
  { type: "email", label: "Email", group: "Contact", keywords: "mail address" },
  { type: "phone", label: "Phone number", group: "Contact", keywords: "tel mobile" },
  { type: "url", label: "Link", group: "Contact", keywords: "url website" },
  { type: "rating", label: "Rating", group: "Rating", keywords: "stars feedback" },
  { type: "scale", label: "Linear scale", group: "Rating", keywords: "1 5 range" },
  { type: "nps", label: "Net promoter (0–10)", group: "Rating", keywords: "nps score" },
  { type: "date", label: "Date", group: "Date", keywords: "calendar day" },
  { type: "time", label: "Time", group: "Date", keywords: "clock hour" },
  { type: "file_upload", label: "File upload", group: "File", keywords: "attachment image document" },
  { type: "heading", label: "Heading", group: "Layout", keywords: "section title h1 large", config: { headingLevel: "h1" } },
  { type: "heading", label: "Subheading", group: "Layout", keywords: "subsection subtitle h2", config: { headingLevel: "h2" } },
  { type: "paragraph", label: "Text", group: "Layout", keywords: "description note paragraph body" },
  { type: "page_break", label: "Page break", group: "Layout", keywords: "page step multi-page next" },
]

export const CATALOG_GROUP_ORDER: CatalogGroup[] = [
  "Text",
  "Choice",
  "Contact",
  "Rating",
  "Date",
  "File",
  "Layout",
]

export function labelForType(type: AiFieldType): string {
  return FIELD_CATALOG.find((c) => c.type === type)?.label ?? type
}

/** A fresh field of `type` with sensible defaults (+ optional seed config). */
export function newField(type: AiFieldType, config?: FieldConfig): EditorField {
  const base: EditorField = { id: genId(), type, label: "", required: false }
  if (config) base.config = config
  if (isChoice(type)) {
    base.options = [
      { id: genId(), label: "Option 1" },
      { id: genId(), label: "Option 2" },
    ]
  }
  return base
}

// ── Conversions to/from the AI spec ───────────────────────────────────

const normLabel = (s: string) => s.trim().toLowerCase()

/** Build a forgiving label→id map (trim + case-insensitive) for logic resolution. */
function labelIdMap(fields: EditorField[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of fields) if (!m.has(normLabel(f.label))) m.set(normLabel(f.label), f.id)
  return m
}

/** Compile the AI's label-referenced logic into schema FieldLogic (id-referenced). */
function compileAiLogic(
  aiLogic: AiField["logic"],
  labelToId: Map<string, string>,
): FieldLogic | undefined {
  if (!aiLogic) return undefined
  const conditions: FieldCondition[] = []
  for (const c of aiLogic.conditions ?? []) {
    const fieldId = labelToId.get(normLabel(c.fieldLabel))
    if (!fieldId) continue // skip references the AI couldn't resolve
    conditions.push({ fieldId, operator: c.operator, value: c.value })
  }
  if (conditions.length === 0) return undefined
  return { action: aiLogic.action, match: aiLogic.match ?? "all", conditions, source: "ai" }
}

export function aiToEditor(ai: AiForm): EditorForm {
  const aiFields = ai.fields ?? []
  const fields: EditorField[] = aiFields.map((f) => ({
    id: genId(),
    type: f.type,
    label: f.label ?? "",
    description: f.description,
    placeholder: f.placeholder,
    required: f.required ?? false,
    options: f.options?.map((label) => ({ id: genId(), label })),
  }))
  // Second pass: now that every field has an id, resolve logic by label.
  const labelToId = labelIdMap(fields)
  aiFields.forEach((af, i) => {
    fields[i].logic = compileAiLogic(af.logic, labelToId)
  })
  return { title: ai.title ?? "Untitled form", fields }
}

/**
 * Apply an AI result onto the current form while PRESERVING field ids, option
 * ids, and conditional logic for fields that survived the edit (matched by
 * type+label, then type). The AI returns a form with no ids/logic, so without
 * this an AI edit would reset every id and drop the user's manual logic.
 */
export function mergeAiIntoEditor(ai: AiForm, prev: EditorForm | null): EditorForm {
  if (!prev) return aiToEditor(ai)
  const pool = [...prev.fields]
  const take = (pred: (f: EditorField) => boolean): EditorField | null => {
    const i = pool.findIndex(pred)
    if (i < 0) return null
    return pool.splice(i, 1)[0]
  }

  const built = (ai.fields ?? []).map((af) => {
    const match =
      take((p) => p.type === af.type && p.label === (af.label ?? "")) ??
      take((p) => p.type === af.type)
    // Preserve-on-omission. On edits the model must re-emit the COMPLETE form,
    // but it routinely drops UNCHANGED properties — most damagingly a choice
    // field's long "options" list. Treat an omitted property as "unchanged" and
    // fall back to the matched field's value, so an AI edit can only CHANGE what
    // the model explicitly sends and can never silently wipe options, help text,
    // or required-ness off a field it wasn't asked to touch. (To actually clear
    // a value the model sends an empty string / empty array, which is not
    // nullish and so wins over the fallback.)
    const field: EditorField = {
      id: match?.id ?? genId(),
      type: af.type,
      label: af.label ?? "",
      description: af.description ?? match?.description,
      placeholder: af.placeholder ?? match?.placeholder,
      required: af.required ?? match?.required ?? false,
      options:
        af.options !== undefined
          ? af.options.map((label) => ({
              id: match?.options?.find((o) => o.label === label)?.id ?? genId(),
              label,
            }))
          : // Omitted: keep the existing options, but only if the (possibly
            // changed) type still uses them — a type change away from choice
            // correctly drops them.
            CHOICE_TYPES.has(af.type)
            ? match?.options
            : undefined,
      // The AI spec carries no config — keep the matched field's (heading level, …).
      config: match?.config,
    }
    return { field, af, match }
  })

  const fields = built.map((b) => b.field)
  // Resolve AI logic against the merged ids; keep prior manual logic if the AI
  // didn't emit any for that field.
  const labelToId = labelIdMap(fields)
  for (const b of built) {
    b.field.logic = b.af.logic ? compileAiLogic(b.af.logic, labelToId) : b.match?.logic
  }

  return { title: ai.title ?? prev.title ?? "Untitled form", fields }
}

export function editorToAi(form: EditorForm): AiForm {
  const idToLabel = new Map(form.fields.map((f) => [f.id, f.label]))
  return {
    title: form.title,
    fields: form.fields.map((f) => ({
      type: f.type,
      label: f.label,
      description: f.description,
      placeholder: f.placeholder,
      required: f.required,
      options: f.options?.map((o) => o.label),
      // Surface existing logic to the AI by label, so it keeps/edits it sanely.
      logic: f.logic
        ? {
            action: f.logic.action,
            match: f.logic.match,
            conditions: f.logic.conditions
              .map((c) => ({
                fieldLabel: idToLabel.get(c.fieldId) ?? "",
                operator: c.operator,
                value:
                  c.value == null
                    ? undefined
                    : Array.isArray(c.value)
                      ? c.value.join(", ")
                      : String(c.value),
              }))
              .filter((c) => c.fieldLabel),
          }
        : undefined,
    })),
  }
}
