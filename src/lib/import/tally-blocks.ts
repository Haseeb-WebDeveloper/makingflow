import { genId, type EditorField, type EditorForm, type EditorSettings } from "@/lib/builder/form-model"
import type { AiFieldType } from "@/lib/ai/form-schema"
import type { FieldConfig, FieldOption } from "@/lib/db/schema"

/**
 * Tally's form model, and how it becomes ours.
 *
 * A Tally form is a FLAT, ordered array of blocks. A question is not one block:
 * it's an optional `TITLE` block followed by one or more input blocks that share
 * a `groupUuid`. Every choice option is its own block in that group. So parsing
 * is a single ordered walk that consumes runs, not a map().
 *
 * The same array is served two ways — embedded in a public form page, and from
 * `GET /forms/{id}/blocks` — which is why this file takes blocks and nothing
 * else. One parser, any source (see ./tally-page.ts for the public-page reader).
 *
 * Output is an `EditorForm`, so importing persists through exactly the path the
 * builder already uses (`saveAiForm`) rather than a second way to write a form.
 */

export type TallyBlock = {
  uuid?: string
  type: string
  /** The semantic question type. Option blocks say MULTIPLE_CHOICE_OPTION in
   *  `type` but MULTIPLE_CHOICE here — this is the one to switch on. */
  groupType?: string
  groupUuid?: string
  payload?: Record<string, unknown>
}

/** A block we understood but cannot render, reported so the import is honest. */
export type SkippedBlock = { type: string; label: string }

export type TallyParseResult = {
  form: EditorForm
  skipped: SkippedBlock[]
}

// ── Rich text ───────────────────────────────────────────────────────────────

/**
 * Tally stores formatted text as `safeHTMLSchema`: a recursive tree where a node
 * is `[content, attrs?]` and `content` is either a string or an array of child
 * nodes. Attributes carry styling and @mentions, both of which we drop.
 *
 * Naively joining the top level yields mention ids and tag names inline
 * ("Your score: ,@score,tag,span,mention,1059f3df…"), so the walk has to
 * descend `content` and never touch the attrs slot.
 */
export function richText(schema: unknown): string {
  if (typeof schema === "string") return schema
  if (!Array.isArray(schema)) return ""
  // `safeHTMLSchema` is always a node LIST, which is what makes this
  // unambiguous — a node and a node list are both arrays, so recursing without
  // tracking which one you're holding walks into the attrs slot and prints
  // "span" and mention uuids as if they were words.
  return schema.map(richTextNode).join("")
}

/** One node: `[content, attrs?]`, where content is a string or a node list. */
function richTextNode(node: unknown): string {
  if (typeof node === "string") return node
  if (!Array.isArray(node)) return ""
  const [content] = node
  if (typeof content === "string") return content
  return Array.isArray(content) ? content.map(richTextNode).join("") : ""
}

/**
 * The visible text of a block, wherever this block type keeps it.
 *
 * Trimmed, because real Tally content is full of trailing whitespace the editor
 * never showed its author — the form this parser was built against has a
 * question ending in a space and an option ending in a newline.
 */
function blockText(block: TallyBlock): string {
  const p = block.payload ?? {}
  if (p.safeHTMLSchema !== undefined) return richText(p.safeHTMLSchema).trim()
  if (typeof p.text === "string") return p.text.trim()
  if (typeof p.title === "string") return p.title.trim()
  return ""
}

// ── Type mapping ────────────────────────────────────────────────────────────

/**
 * Tally question type → ours. Keyed on `groupType` with `type` as a fallback,
 * and accepting both the group name and the option-block name (MULTIPLE_CHOICE
 * vs MULTIPLE_CHOICE_OPTION) because which one appears depends on the source.
 *
 * INPUT_NUMBER lands on short_text deliberately: we have no numeric input type
 * (see fieldTypeEnum), and an import is the wrong place to add one. The label
 * and the answers survive; the numeric keyboard doesn't.
 */
const QUESTION_TYPES: Record<string, AiFieldType> = {
  INPUT_TEXT: "short_text",
  INPUT_NUMBER: "short_text",
  INPUT_EMAIL: "email",
  INPUT_LINK: "url",
  INPUT_PHONE_NUMBER: "phone",
  INPUT_DATE: "date",
  INPUT_TIME: "time",
  TEXTAREA: "long_text",
  FILE_UPLOAD: "file_upload",
  LINEAR_SCALE: "scale",
  RATING: "rating",
  MULTIPLE_CHOICE: "multiple_choice",
  MULTIPLE_CHOICE_OPTION: "multiple_choice",
  DROPDOWN: "dropdown",
  DROPDOWN_OPTION: "dropdown",
  MULTI_SELECT: "multi_select",
  MULTI_SELECT_OPTION: "multi_select",
  CHECKBOXES: "checkboxes",
  CHECKBOX: "checkboxes",
}

/** Content blocks that carry no answer but are worth keeping. */
const CONTENT_TYPES: Record<string, { type: AiFieldType; config?: FieldConfig }> = {
  HEADING_1: { type: "heading", config: { headingLevel: "h1" } },
  HEADING_2: { type: "heading", config: { headingLevel: "h2" } },
  // We render h1/h2 only, so h3 folds into the smaller of the two rather than
  // being dropped — the text matters more than one level of hierarchy.
  HEADING_3: { type: "heading", config: { headingLevel: "h2" } },
  TEXT: { type: "paragraph" },
  PAGE_BREAK: { type: "page_break" },
  IMAGE: { type: "image" },
}

/**
 * Block types with no counterpart here. Listed rather than defaulted so a type
 * Tally adds later is reported as unknown instead of silently vanishing, and so
 * the import can tell the user exactly what it left behind.
 *
 * RANKING, SIGNATURE and HIDDEN_FIELDS exist in our fieldTypeEnum but have no
 * renderer, which is why they're here and not in QUESTION_TYPES — importing them
 * would produce questions a respondent never sees.
 */
const UNSUPPORTED: Record<string, string> = {
  MATRIX: "Matrix",
  MATRIX_ROW: "Matrix",
  MATRIX_COLUMN: "Matrix",
  PAYMENT: "Payment",
  SIGNATURE: "Signature",
  RANKING: "Ranking",
  RANKING_OPTION: "Ranking",
  HIDDEN_FIELDS: "Hidden fields",
  CALCULATED_FIELDS: "Calculated fields",
  EMBED: "Embed",
  EMBED_VIDEO: "Embedded video",
  EMBED_AUDIO: "Embedded audio",
  RESPONDENT_COUNTRY: "Respondent country",
}

/** Structural noise — dropped without troubling the user. */
const IGNORED = new Set(["DIVIDER", "CONDITIONAL_LOGIC", "CAPTCHA"])

const questionType = (b: TallyBlock): AiFieldType | undefined =>
  QUESTION_TYPES[b.groupType ?? ""] ?? QUESTION_TYPES[b.type]

// ── Payload → config ────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined
/** A non-empty string, trimmed — see the note on blockText about whitespace. */
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined

/**
 * Tally guards optional values behind a `hasX` boolean and leaves a stale number
 * in `x` when it's false — so reading `maxCharacters` without checking
 * `hasMaxCharacters` imports a limit the form does not actually enforce.
 */
function readConfig(type: AiFieldType, p: Record<string, unknown>): FieldConfig {
  const c: FieldConfig = {}

  if (p.hasMinCharacters === true) c.minLength = num(p.minCharacters)
  if (p.hasMaxCharacters === true) c.maxLength = num(p.maxCharacters)
  if (p.hasDefaultAnswer === true) c.defaultValue = str(p.defaultAnswer)

  if (type === "scale") {
    c.min = num(p.start)
    c.max = num(p.end)
    c.step = num(p.step)
    if (p.hasLeftLabel === true) c.minLabel = str(p.leftLabel)
    if (p.hasRightLabel === true) c.maxLabel = str(p.rightLabel)
  }

  if (type === "rating") c.ratingMax = num(p.stars)

  if (type === "file_upload") {
    if (Array.isArray(p.allowedFiles) && p.allowedFiles.length > 0) {
      c.allowedFileTypes = p.allowedFiles.filter((f): f is string => typeof f === "string")
    }
    if (p.hasMaxFileSize === true) c.maxFileSizeMb = num(p.maxFileSize)
    if (p.hasMaxFiles === true) c.maxFiles = num(p.maxFiles)
  }

  if (p.hasOtherOption === true) c.allowOther = true
  if (p.randomize === true) c.randomizeOptions = true
  if (type === "image") c.imageUrl = str(p.url) ?? str(p.src)

  // Drop keys that came back undefined so the stored config stays minimal.
  for (const k of Object.keys(c) as (keyof FieldConfig)[]) {
    if (c[k] === undefined) delete c[k]
  }
  return c
}

// ── Parse ───────────────────────────────────────────────────────────────────

/**
 * Turn a Tally block array into an editable form.
 *
 * A single ordered pass with one piece of lookbehind (`pendingTitle`): a TITLE
 * block belongs to the question that follows it, and it sits in a DIFFERENT
 * group from that question — so it cannot be found by grouping alone.
 */
export function parseTallyBlocks(blocks: TallyBlock[], formName?: string): TallyParseResult {
  const fields: EditorField[] = []
  const skipped: SkippedBlock[] = []
  let title = formName?.trim() ?? ""
  let pendingTitle = ""
  let pendingDescription = ""

  const skip = (label: string, type: string) => {
    if (!skipped.some((s) => s.type === type && s.label === label)) {
      skipped.push({ type, label })
    }
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]
    const p = b.payload ?? {}

    if (b.type === "FORM_TITLE") {
      if (!title) title = blockText(b)
      continue
    }
    if (b.type === "TITLE") {
      pendingTitle = blockText(b)
      continue
    }
    if (b.type === "LABEL") {
      pendingDescription = blockText(b)
      continue
    }

    // Everything past Tally's thank-you page is the post-submit screen, not the
    // form. Importing it would turn a confirmation message into trailing
    // questions, so stop here — and say so rather than dropping it quietly.
    if (b.type === "PAGE_BREAK" && p.isThankYouPage === true) {
      if (i < blocks.length - 1) skip("Thank-you page content", "PAGE_BREAK")
      break
    }

    const content = CONTENT_TYPES[b.type]
    if (content) {
      const text = blockText(b)
      // An empty heading or paragraph is a spacer in Tally and a blank row here.
      // Page breaks and images legitimately carry no text.
      const carriesText = content.type === "heading" || content.type === "paragraph"
      if (carriesText && !text.trim()) continue
      const config = { ...(content.config ?? {}), ...readConfig(content.type, p) }
      fields.push({
        id: genId(),
        type: content.type,
        label: carriesText ? text : "",
        required: false,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      })
      pendingTitle = ""
      pendingDescription = ""
      continue
    }

    const type = questionType(b)
    if (!type) {
      const name = UNSUPPORTED[b.groupType ?? ""] ?? UNSUPPORTED[b.type]
      if (name) skip(pendingTitle || str(p.name) || name, name)
      else if (!IGNORED.has(b.type)) skip(pendingTitle || b.type, b.type)
      pendingTitle = ""
      pendingDescription = ""
      continue
    }

    // Consume the whole group: every option of this question is a sibling block
    // carrying the same groupUuid. A block with no groupUuid stands alone.
    const group: TallyBlock[] = [b]
    if (b.groupUuid) {
      while (i + 1 < blocks.length && blocks[i + 1].groupUuid === b.groupUuid) {
        i += 1
        group.push(blocks[i])
      }
    }

    // The "Other" choice is a marker for a free-text box, not a real option — it
    // becomes config.allowOther rather than an option labelled "Other".
    const options: FieldOption[] = group
      .filter((o) => o.payload?.isOtherOption !== true)
      .map((o) => str(o.payload?.text))
      .filter((label): label is string => Boolean(label))
      .map((label) => ({ id: genId(), label }))

    const hasOther = group.some((o) => o.payload?.isOtherOption === true)
    const config = readConfig(type, p)
    if (hasOther) config.allowOther = true

    // The label lives on the TITLE block for most questions; a question built
    // without one keeps it in `payload.name` instead.
    const label = pendingTitle || str(p.name) || ""

    fields.push({
      id: genId(),
      type,
      label,
      required: p.isRequired === true,
      ...(pendingDescription ? { description: pendingDescription } : {}),
      ...(str(p.placeholder) ? { placeholder: str(p.placeholder) } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
    })
    pendingTitle = ""
    pendingDescription = ""
  }

  return { form: { title: title || "Imported form", fields }, skipped }
}

/** Form-level settings Tally exposes that we have somewhere to put. */
export function parseTallySettings(settings: unknown): EditorSettings {
  if (!settings || typeof settings !== "object") return {}
  const s = settings as Record<string, unknown>
  const out: EditorSettings = {}
  if (typeof s.hasProgressBar === "boolean") out.showProgressBar = s.hasProgressBar
  const redirect = str(s.redirectOnCompletion)
  if (redirect) out.redirectUrl = redirect
  return out
}
