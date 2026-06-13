import type { AiForm, AiFieldType } from "@/lib/ai/form-schema"
import type { FieldLogic, FieldOption } from "@/lib/db/schema"

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
}

export type EditorForm = {
  title: string
  fields: EditorField[]
}

export const genId = () => crypto.randomUUID()

export const CHOICE_TYPES = new Set<AiFieldType>([
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "multi_select",
])
export const CONTENT_TYPES = new Set<AiFieldType>(["heading", "paragraph"])

export const isChoice = (t: AiFieldType) => CHOICE_TYPES.has(t)
export const isContent = (t: AiFieldType) => CONTENT_TYPES.has(t)

// ── Insert palette catalog ────────────────────────────────────────────
export type CatalogGroup = "Text" | "Choice" | "Contact" | "Rating" | "Date" | "File" | "Layout"

export type CatalogItem = {
  type: AiFieldType
  label: string
  group: CatalogGroup
  keywords?: string
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
  { type: "heading", label: "Heading", group: "Layout", keywords: "section title" },
  { type: "paragraph", label: "Text", group: "Layout", keywords: "description note" },
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

/** A fresh field of `type` with sensible defaults. */
export function newField(type: AiFieldType): EditorField {
  const base: EditorField = { id: genId(), type, label: "", required: false }
  if (isChoice(type)) {
    base.options = [
      { id: genId(), label: "Option 1" },
      { id: genId(), label: "Option 2" },
    ]
  }
  return base
}

// ── Conversions to/from the AI spec ───────────────────────────────────
export function aiToEditor(ai: AiForm): EditorForm {
  return {
    title: ai.title ?? "Untitled form",
    fields: (ai.fields ?? []).map((f) => ({
      id: genId(),
      type: f.type,
      label: f.label ?? "",
      description: f.description,
      placeholder: f.placeholder,
      required: f.required ?? false,
      options: f.options?.map((label) => ({ id: genId(), label })),
    })),
  }
}

export function editorToAi(form: EditorForm): AiForm {
  return {
    title: form.title,
    fields: form.fields.map((f) => ({
      type: f.type,
      label: f.label,
      description: f.description,
      placeholder: f.placeholder,
      required: f.required,
      options: f.options?.map((o) => o.label),
    })),
  }
}
