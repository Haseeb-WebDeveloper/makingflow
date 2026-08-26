import type { AiForm, AiField, AiFieldType, AiOperation } from "@/lib/ai/form-schema"
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

/** Form settings the AI (and the fast path) can edit inline — the same values
 *  otherwise set in the Settings tab. A subset of the full FormSettings: the
 *  knobs that make sense to change by instruction. `captchaEnabled` is
 *  deliberately absent — spam protection shouldn't turn off on a misread. */
export type EditorSettings = {
  thankYouMessage?: string
  successBody?: string
  redirectUrl?: string
  submitButtonLabel?: string
  showProgressBar?: boolean
  chooserStyle?: "list" | "cards"
  renderMode?: "classic" | "conversational"
}

/** The branding the AI can set. Mirrors the two FormTheme keys that are
 *  actually rendered (see field-control.tsx) — the colour/font/radius keys on
 *  FormTheme have no consumer anywhere, so there is nothing to point them at. */
export type EditorTheme = {
  logoUrl?: string
  coverImageUrl?: string
}

/**
 * Read-only facts about the form that aren't part of its content, supplied so
 * the model can ANSWER questions about it instead of guessing.
 *
 * The share link is the motivating case: asked "what's the form link?", a model
 * given no link and told to always report something specific will invent a
 * plausible one, and a fabricated URL is worse than "I don't know" — it gets
 * pasted to a respondent. These are never editable; edits go through the
 * publish dialog.
 */
export type FormFacts = {
  /** The live public link. Null when the form has never been published. */
  shareUrl?: string | null
  status?: string
}

export type EditorForm = {
  title: string
  fields: EditorField[]
  /** Present when loaded for editing; carried through AI/fast-path edits + save. */
  settings?: EditorSettings
  /** Logo + banner. Carried through edits the same way settings are. */
  theme?: EditorTheme
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
export const CONTENT_TYPES = new Set<AiFieldType>(["heading", "paragraph", "image"])
// Layout/structural blocks that never collect an answer (page_break is a
// multi-page divider, not a question).
export const NON_ANSWER_TYPES = new Set<AiFieldType>(["heading", "paragraph", "image", "page_break"])

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
  { type: "image", label: "Image", group: "Layout", keywords: "picture photo upload media banner" },
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
    config: f.config ? { ...f.config } : undefined,
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
      // Preserve-on-omission, as above: the model now CAN send config, so merge
      // what it sent over the matched field's rather than replacing outright —
      // sending ratingMax must not drop the ratingIcon beside it.
      config: af.config ? { ...(match?.config ?? {}), ...af.config } : match?.config,
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

  // The AI spec carries no settings or branding — keep whatever the form had.
  return {
    title: ai.title ?? prev.title ?? "Untitled form",
    fields,
    settings: prev.settings,
    theme: prev.theme,
  }
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
      // Surface config too (rating scale, image source, heading level) so a
      // regeneration can preserve or change it instead of flattening it.
      config: f.config,
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

// ── Operation-based editing ───────────────────────────────────────────────

/**
 * The current form annotated with a stable `ref` per field, sent to the model so
 * an edit can target fields unambiguously (by ref, not by re-matching labels).
 */
// Returns the compact form `context` the model edits, plus `refs`: a map from
// each short ref (f1, f1o2, …) back to the real field/option id for translating
// the model's operations afterwards (see resolveOpRefs).
export function toEditContext(form: EditorForm, facts?: FormFacts) {
  const idToLabel = new Map(form.fields.map((f) => [f.id, f.label]))
  const refs: Record<string, string> = {}

  const fields = form.fields.map((f, i) => {
    // Short, sequential refs instead of raw UUIDs: LLMs reliably copy "f3"/"f3o2"
    // but routinely mis-transcribe a 36-char uuid, which then silently no-ops.
    const fref = `f${i + 1}`
    refs[fref] = f.id
    const options = f.options?.map((o, j) => {
      const oref = `${fref}o${j + 1}`
      refs[oref] = o.id
      return { ref: oref, label: o.label }
    })
    return {
      ref: fref,
      // 1-based position from the top, so the model can ground "top"/"bottom"/
      // "3rd field" and reason about placement against what the user sees.
      pos: i + 1,
      type: f.type,
      label: f.label,
      ...(f.description ? { description: f.description } : {}),
      // Surface the current placeholder so the model can see/edit/remove it
      // (update_field set.placeholder); without this an edit to it is blind.
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      required: f.required,
      // Type-specific knobs (rating scale, file limits, heading size, image
      // source). Without these an edit to them is blind — the model can't say
      // what the rating is out of, let alone change it relative to now. Omitted
      // when empty so the context stays small.
      ...(f.config && Object.keys(f.config).length > 0 ? { config: f.config } : {}),
      ...(options ? { options } : {}),
      ...(f.logic
        ? {
            logic: {
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
            },
          }
        : {}),
    }
  })

  // Surface current post-submit settings so the model can see and edit them
  // (e.g. "change the thank-you message"). Compact and always present, so an
  // empty value reads as "not set yet" rather than being invisible.
  const settings = {
    thankYouMessage: form.settings?.thankYouMessage ?? "",
    submitButtonLabel: form.settings?.submitButtonLabel ?? "",
    redirectUrl: form.settings?.redirectUrl ?? "",
    successBody: form.settings?.successBody ?? "",
    showProgressBar: form.settings?.showProgressBar ?? false,
    chooserStyle: form.settings?.chooserStyle ?? "cards",
    renderMode: form.settings?.renderMode ?? "classic",
  }

  // Always present, so an empty value reads as "no logo yet" rather than being
  // invisible — the model needs to know whether it's adding or replacing.
  const theme = {
    logoUrl: form.theme?.logoUrl ?? "",
    coverImageUrl: form.theme?.coverImageUrl ?? "",
  }

  // Read-only. Named so it can't be mistaken for something update_settings
  // writes, and always present so "not published yet" is legible rather than
  // absent — an absent key is what invites a guess.
  const about = {
    status: facts?.status ?? "draft",
    shareUrl: facts?.shareUrl ?? "",
    fieldCount: form.fields.filter((f) => !NON_ANSWER_TYPES.has(f.type)).length,
    totalBlocks: form.fields.length,
  }

  return { context: { title: form.title, about, settings, theme, fields }, refs }
}

/**
 * Does this instruction ask to REBUILD the form from an attached image, rather
 * than to use that image within the form?
 *
 * An attachment used to force full regeneration unconditionally, so "use this
 * as the logo" would rebuild an entire form from a picture of a logo. Only an
 * explicit rebuild should throw the existing form away; everything else is an
 * edit that happens to have an image to hand.
 */
export function isRebuildRequest(text: string): boolean {
  const t = text.toLowerCase()
  // "as the logo" / "as a banner" is about placing the image, never rebuilding.
  // Checked FIRST so it beats the verbs below: "make this the header image"
  // contains "make this", which would otherwise read as a rebuild.
  if (/\b(as|for|to be)\s+(the\s+|a\s+|our\s+|my\s+)?(logo|banner|cover|header image)\b/.test(t)) {
    return false
  }
  return (
    /\b(rebuild|recreate|re-create|replicate|reproduce)\b/.test(t) ||
    /\bbuild\b[^.]*\bfrom (this|the) (image|screenshot|picture|photo|design|mockup)\b/.test(t) ||
    /\b(make|create|build)\b[^.]*\b(this|that) (form|questionnaire|survey)\b/.test(t) ||
    /\bcopy (this|the) (form|screenshot|design)\b/.test(t)
  )
}

/** Translate an op's ref-bearing fields from short refs back to real ids; passes
 *  through anything that isn't a known short ref (option text, "start", etc.). */
export function resolveOpRefs(op: AiOperation, refs: Record<string, string>): AiOperation {
  const map = (v?: string) => (v != null && refs[v] != null ? refs[v] : v)
  return {
    ...op,
    target: map(op.target),
    after: map(op.after),
    label: map(op.label),
    from: map(op.from),
    // Field placement references a field ref — translate it back to the real id.
    placement: op.placement ? { ...op.placement, ref: map(op.placement.ref) } : op.placement,
    // set_required lists field refs in `targets` — translate each short ref too.
    targets: op.targets?.map((t) => map(t) as string),
  }
}

/**
 * Resolve which option a model reference points at, tolerantly: exact ref (id),
 * then exact label, then a UNIQUE case-insensitive substring match (so "discord"
 * resolves "Discord message"). Ambiguous → -1 (skip rather than guess wrong).
 */
function resolveOptionIndex(options: FieldOption[], query?: string): number {
  if (query == null) return -1
  let i = options.findIndex((o) => o.id === query)
  if (i >= 0) return i
  const q = query.trim().toLowerCase()
  if (!q) return -1
  i = options.findIndex((o) => o.label.trim().toLowerCase() === q)
  if (i >= 0) return i
  const hits = options
    .map((o, idx) => ({ idx, l: o.label.trim().toLowerCase() }))
    .filter(({ l }) => l.includes(q) || q.includes(l))
  return hits.length === 1 ? hits[0].idx : -1
}

/**
 * Apply a list of AI edit operations to a form, deterministically. Ops target
 * fields by their stable id (the `ref` the model was given); anything an op
 * doesn't touch is left exactly as-is, so an edit can never silently drop or
 * garble unrelated fields/options. Unknown refs are skipped, not fatal.
 */
export function applyOperations(form: EditorForm, ops: AiOperation[]): EditorForm {
  let title = form.title
  // Carry settings through untouched unless an update_settings op changes them.
  let settings: EditorSettings | undefined = form.settings ? { ...form.settings } : undefined
  // Same contract for branding: untouched unless a set_theme op changes it.
  let theme: EditorTheme | undefined = form.theme ? { ...form.theme } : undefined
  // Deep-copy the parts we mutate (fields + their option arrays).
  const fields: EditorField[] = form.fields.map((f) => ({
    ...f,
    options: f.options?.map((o) => ({ ...o })),
  }))

  const byId = (ref?: string) => fields.find((f) => f.id === ref)
  const indexOf = (ref?: string) => fields.findIndex((f) => f.id === ref)
  // Where to place a field. Explicit `placement` (top/bottom/before/after) is
  // preferred; falls back — in order — to a legacy `after` ref, then a bare
  // zero-based `toIndex`. The model sometimes emits move_field WITHOUT placement
  // and reuses move_option's `toIndex` for the slot (seen in the wild), so
  // honoring it lands the field where intended instead of silently appending.
  const placeIndex = (op: AiOperation): number => {
    const p = op.placement
    if (p) {
      if (p.mode === "top") return 0
      if (p.mode === "bottom") return fields.length
      const i = indexOf(p.ref)
      if (i < 0) return fields.length // unknown ref → append rather than guess
      return p.mode === "before" ? i : i + 1
    }
    if (op.after != null) {
      if (op.after === "start") return 0
      const i = indexOf(op.after)
      if (i >= 0) return i + 1
    }
    if (typeof op.toIndex === "number" && op.toIndex >= 0) {
      return Math.max(0, Math.min(op.toIndex, fields.length))
    }
    return fields.length
  }

  for (const op of ops) {
    switch (op.op) {
      case "rename_form": {
        if (op.title != null) title = op.title
        break
      }
      case "add_field": {
        if (!op.field) break
        const ef: EditorField = {
          id: genId(),
          type: op.field.type,
          label: op.field.label ?? "",
          description: op.field.description,
          placeholder: op.field.placeholder,
          required: op.field.required ?? false,
          options: op.field.options?.map((label) => ({ id: genId(), label })),
          config: op.field.config ? { ...op.field.config } : undefined,
        }
        fields.splice(placeIndex(op), 0, ef)
        if (op.field.logic) ef.logic = compileAiLogic(op.field.logic, labelIdMap(fields))
        break
      }
      case "remove_field": {
        const i = indexOf(op.target)
        if (i >= 0) fields.splice(i, 1)
        break
      }
      case "move_field": {
        const i = indexOf(op.target)
        if (i < 0) break
        const [f] = fields.splice(i, 1)
        // Placement is resolved against the array AFTER removal, so a "before/
        // after ref" lands correctly relative to the remaining fields.
        fields.splice(placeIndex(op), 0, f)
        break
      }
      case "update_field": {
        const f = byId(op.target)
        if (!f) break
        // The flat op schema invites the model to dump the new LABEL into `to`
        // (or `label`) instead of `set.label` — observed in the wild for bulk
        // relabels like "number each question". Treat a bare string in `to`/
        // `label` as a label change so the edit isn't silently dropped.
        const set =
          op.set ??
          (typeof op.to === "string"
            ? { label: op.to }
            : typeof op.label === "string"
              ? { label: op.label }
              : undefined)
        if (!set) break
        if (set.label != null) f.label = set.label
        if (set.description != null) f.description = set.description
        if (set.placeholder != null) f.placeholder = set.placeholder
        if (set.required != null) f.required = set.required
        // MERGE config, never replace: "make it out of 10" sends only ratingMax
        // and must not wipe the ratingIcon sitting beside it.
        if (set.config) f.config = { ...(f.config ?? {}), ...set.config }
        if (set.type != null && set.type !== f.type) {
          f.type = set.type
          // Keep options only if the new type still uses them.
          if (!isChoice(f.type)) f.options = undefined
          else if (!f.options) f.options = []
        }
        break
      }
      case "add_option": {
        const f = byId(op.target)
        // The model is inconsistent about WHICH string field it fills (it often
        // dumps the value into `to`), so accept the new option text from any of
        // them — it gets the value right even when it picks the wrong field.
        const text = op.label ?? op.to ?? op.from
        if (!f || text == null || !isChoice(f.type)) break
        f.options = f.options ?? []
        const afterIdx = op.after === "start" ? -1 : resolveOptionIndex(f.options, op.after)
        const at = op.after === "start" ? 0 : afterIdx >= 0 ? afterIdx + 1 : f.options.length
        f.options.splice(at, 0, { id: genId(), label: text })
        break
      }
      case "remove_option": {
        const f = byId(op.target)
        if (!f || !f.options) break
        const i = resolveOptionIndex(f.options, op.label ?? op.from ?? op.to)
        if (i >= 0) f.options.splice(i, 1)
        break
      }
      case "rename_option": {
        const f = byId(op.target)
        const text = op.to ?? op.label
        if (!f || text == null || !f.options) break
        const i = resolveOptionIndex(f.options, op.from ?? op.label)
        if (i >= 0) f.options[i].label = text
        break
      }
      case "move_option": {
        const f = byId(op.target)
        if (!f || op.toIndex == null || !f.options) break
        const i = resolveOptionIndex(f.options, op.label ?? op.from ?? op.to)
        if (i < 0) break
        const [o] = f.options.splice(i, 1)
        const dest = Math.max(0, Math.min(op.toIndex, f.options.length))
        f.options.splice(dest, 0, o)
        break
      }
      case "set_options": {
        const f = byId(op.target)
        if (!f || op.options == null || !isChoice(f.type)) break
        const prev = f.options ?? []
        f.options = op.options.map((label) => ({
          id: prev.find((o) => o.label === label)?.id ?? genId(),
          label,
        }))
        break
      }
      case "set_logic": {
        const f = byId(op.target)
        if (!f || !op.logic) break
        f.logic = compileAiLogic(op.logic, labelIdMap(fields))
        break
      }
      case "remove_logic": {
        const f = byId(op.target)
        if (f) f.logic = undefined
        break
      }
      case "set_required": {
        if (op.set?.required == null) break
        const value = op.set.required
        // Omitted/empty targets = every answerable field. Content blocks and
        // page breaks can't be required, so they're always skipped.
        const targetIds = op.targets && op.targets.length > 0 ? new Set(op.targets) : null
        for (const f of fields) {
          if (!isAnswerable(f.type)) continue
          if (targetIds && !targetIds.has(f.id)) continue
          f.required = value
        }
        break
      }
      case "update_settings": {
        if (!op.settings) break
        settings = { ...(settings ?? {}) }
        const s = op.settings
        // Only the keys the model sent change; the rest carry through. An empty
        // string is a deliberate clear (handled at save time → undefined/null).
        if (s.thankYouMessage != null) settings.thankYouMessage = s.thankYouMessage
        if (s.successBody != null) settings.successBody = s.successBody
        if (s.redirectUrl != null) settings.redirectUrl = s.redirectUrl
        if (s.submitButtonLabel != null) settings.submitButtonLabel = s.submitButtonLabel
        if (s.showProgressBar != null) settings.showProgressBar = s.showProgressBar
        if (s.chooserStyle != null) settings.chooserStyle = s.chooserStyle
        if (s.renderMode != null) settings.renderMode = s.renderMode
        break
      }
      case "set_theme": {
        if (!op.theme) break
        theme = { ...(theme ?? {}) }
        // Only the keys the model sent change. An empty string is a deliberate
        // removal — normalised to undefined so the asset is cleared at save.
        if (op.theme.logoUrl != null) theme.logoUrl = op.theme.logoUrl.trim() || undefined
        if (op.theme.coverImageUrl != null)
          theme.coverImageUrl = op.theme.coverImageUrl.trim() || undefined
        break
      }
    }
  }

  return { title, fields, settings, theme }
}

// ── Deterministic fast path for trivial edits ─────────────────────────────
// Some edit intents are so simple and unambiguous that routing them through the
// LLM is pure downside: latency, cost, and a real chance the model loops or
// picks the wrong op. We parse those in code and apply them directly, with NO
// model call. Anything we can't match with high confidence returns null and
// falls through to the AI.

export type SimpleEdit = { operations: AiOperation[]; summary: string }

/** A field label with any leading question number ("12. ", "3) ") and quotes
 *  stripped, normalized — so "email" matches "2. Email Address". */
const coreLabel = (s: string) =>
  normLabel(s.replace(/^\s*\d+[.)]\s*/, "").replace(/["'`]/g, ""))

/** Resolve a spoken field name to exactly one field, or null if none / ambiguous
 *  (ambiguity defers to the AI rather than guessing wrong). */
function resolveFieldByName(fields: EditorField[], query: string): EditorField | null {
  const q = coreLabel(query)
  if (!q) return null
  // Exact core-label match first.
  let hits = fields.filter((f) => coreLabel(f.label) === q)
  if (hits.length === 0) {
    // Then a unique substring match either direction ("email" ⊂ "email address").
    hits = fields.filter((f) => {
      const c = coreLabel(f.label)
      return c.length > 0 && (c.includes(q) || q.includes(c))
    })
  }
  return hits.length === 1 ? hits[0] : null
}

const ALL_FIELDS_RE =
  /^(?:all|all fields|all questions|every field|every question|everything|all of them|them all)$/

/**
 * Deterministic fast path for trivial edits. Tries each recognizer in turn and
 * returns the first hit; null means "hand it to the AI". Every recognizer is
 * conservative — it only fires when the intent AND the target field(s) are
 * unambiguous, so a wrong guess is never applied.
 */
export function matchSimpleEdit(instruction: string, form: EditorForm): SimpleEdit | null {
  return (
    matchRequiredEdit(instruction, form) ??
    matchMoveEdit(instruction, form) ??
    matchSettingsEdit(instruction)
  )
}

/**
 * Recognize a post-submit settings change with an explicit new value — "change
 * the thank you message to X", "set the submit button to Send", "set the
 * redirect url to https://…". Deterministic when a value is given; anything
 * without a clear "to <value>" (e.g. "make the thank-you shorter") defers to the
 * AI. The form isn't needed — these are global settings.
 */
function matchSettingsEdit(instruction: string): SimpleEdit | null {
  const t = instruction.trim().replace(/\s+/g, " ")
  const m =
    /^(?:please\s+)?(?:set|change|update|edit)\s+the\s+(submit(?: button)?(?: label| text)?|redirect(?: url| link)?|(?:thank[- ]?you|success)(?: page)?(?: title| heading| message| msg| body| description| text)?)\s+(?:to|as|:)\s+([\s\S]+)$/i.exec(
      t,
    )
  if (!m) return null
  const value = m[2].trim().replace(/^["'`]+|["'`]+$/g, "").trim()
  if (!value) return null
  const key = m[1].toLowerCase()

  if (/^submit/.test(key)) {
    return {
      operations: [{ op: "update_settings", settings: { submitButtonLabel: value } }],
      summary: `Set the **submit button** to “${value}”.`,
    }
  }
  if (/^redirect/.test(key)) {
    return {
      operations: [{ op: "update_settings", settings: { redirectUrl: value } }],
      summary: `Set the **redirect URL** to ${value}.`,
    }
  }
  // Thank-you / success page: disambiguate the TITLE from the MESSAGE/body the
  // same way the editor labels them. "message / body / description / text" →
  // successBody; "title / heading" (or a bare "thank you") → thankYouMessage.
  if (/\b(message|msg|body|description|text)\b/.test(key)) {
    return {
      operations: [{ op: "update_settings", settings: { successBody: value } }],
      summary: `Updated the **thank-you message**.`,
    }
  }
  return {
    operations: [{ op: "update_settings", settings: { thankYouMessage: value } }],
    summary: `Set the **thank-you title** to “${value}”.`,
  }
}

/** Strip filler so a spoken field reference resolves: "the name input" → "name". */
const cleanFieldRef = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/\s+(?:input|field|question|block|section)$/, "")
    .trim()

/**
 * Recognize a required/optional toggle — the most common trivial edit — and
 * turn it into a deterministic set_required op. Matches phrasings like:
 *   "make Email optional", "set Phone Number as required", "mark all fields
 *   required", "make email and phone required". Returns null for anything it
 *   can't confidently parse (unknown/ambiguous field, other intent).
 */
function matchRequiredEdit(instruction: string, form: EditorForm): SimpleEdit | null {
  const t = instruction.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "")
  const m =
    /^(?:please\s+)?(?:make|set|mark)\s+(.+?)\s+(?:as\s+|to\s+be\s+)?(required|require|requires|mandatory|compulsory|optional|not required|not require|non-required)$/i.exec(
      t,
    )
  if (!m) return null

  const fieldPart = m[1].trim().toLowerCase().replace(/^the\s+/, "")
  const required = !/optional|not requi|non-required/i.test(m[2])
  const word = required ? "required" : "optional"

  // "make all fields required" → every answerable field (no targets).
  if (ALL_FIELDS_RE.test(fieldPart)) {
    if (!form.fields.some((f) => isAnswerable(f.type))) return null
    return {
      operations: [{ op: "set_required", set: { required } }],
      summary: `Made **all fields** ${word}.`,
    }
  }

  // One or more named fields, comma / "and" / "&" separated.
  const names = fieldPart
    .split(/\s*(?:,|\band\b|&)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.length === 0) return null

  const matched: EditorField[] = []
  for (const name of names) {
    const f = resolveFieldByName(form.fields, name)
    // Unknown, ambiguous, or a non-answerable block (headings can't be required)
    // → hand the whole thing to the AI rather than half-apply.
    if (!f || !isAnswerable(f.type)) return null
    if (!matched.includes(f)) matched.push(f)
  }
  if (matched.length === 0) return null

  const names_ = matched.map((f) => `**${f.label}**`)
  const list =
    names_.length === 1
      ? names_[0]
      : `${names_.slice(0, -1).join(", ")} and ${names_[names_.length - 1]}`
  return {
    operations: [{ op: "set_required", targets: matched.map((f) => f.id), set: { required } }],
    summary: `Made ${list} ${word}.`,
  }
}

// Keywords that end a move phrase at the very top / very bottom, no target field.
const MOVE_TOP_RE = /^(?:to )?(?:the )?(?:very )?(?:top|start|beginning|first)$/
const MOVE_BOTTOM_RE = /^(?:to )?(?:the )?(?:very )?(?:bottom|end|last)$/

/**
 * Recognize a field reorder — "move Email above Full Name", "move phone below
 * email", "move the name field to the top", "move rating to the bottom". Emits a
 * deterministic move_field with the right placement. Returns null unless BOTH
 * the field to move and (for before/after) the anchor resolve unambiguously —
 * exactly the case that keeps burning the AI on placement.
 */
function matchMoveEdit(instruction: string, form: EditorForm): SimpleEdit | null {
  const t = instruction.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "")
  // move <what> <relation> [<anchor>]
  const m =
    /^(?:please\s+)?move\s+(.+?)\s+(above|below|before|after|under|underneath|to the top|to top|to the start|to the beginning|to the very top|to the bottom|to the end|to the very bottom|to be first|to be last|first|last)\b(.*)$/i.exec(
      t,
    )
  if (!m) return null

  const what = resolveFieldByName(form.fields, cleanFieldRef(m[1]))
  if (!what) return null
  const relation = m[2].toLowerCase()
  const rest = cleanFieldRef(m[3].replace(/^\s*of the form\s*$/, ""))

  // Top / bottom — no anchor field needed.
  if (MOVE_TOP_RE.test(relation)) {
    return {
      operations: [{ op: "move_field", target: what.id, placement: { mode: "top" } }],
      summary: `Moved **${what.label}** to the top.`,
    }
  }
  if (MOVE_BOTTOM_RE.test(relation)) {
    return {
      operations: [{ op: "move_field", target: what.id, placement: { mode: "bottom" } }],
      summary: `Moved **${what.label}** to the bottom.`,
    }
  }

  // Relative to an anchor field, which must resolve and differ from `what`.
  const anchor = resolveFieldByName(form.fields, rest)
  if (!anchor || anchor.id === what.id) return null
  const mode = /^(above|before)$/.test(relation) ? "before" : "after"
  return {
    operations: [{ op: "move_field", target: what.id, placement: { mode, ref: anchor.id } }],
    summary: `Moved **${what.label}** ${mode} **${anchor.label}**.`,
  }
}
