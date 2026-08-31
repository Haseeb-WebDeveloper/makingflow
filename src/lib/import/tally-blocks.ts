import { genId, type EditorField, type EditorForm, type EditorSettings } from "@/lib/builder/form-model"
import type { AiFieldType } from "@/lib/ai/form-schema"
import type { FieldCondition, FieldConfig, FieldOption } from "@/lib/db/schema"

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

/**
 * Where a parsed field came from in Tally.
 *
 * This exists so API-imported responses can be joined to their question by
 * IDENTITY rather than by matching label text: Tally's submissions endpoint
 * keys every answer to a question id, and that question's `fields[]` carry the
 * `blockGroupUuid` recorded here. Without it the API path would inherit the
 * CSV path's one weakness — a label edited after the responses were collected
 * silently stops matching.
 *
 * Kept beside the form rather than inside `EditorField` because it is a fact
 * about the import, not about the form: nothing downstream of the import
 * should know or care that these questions used to live in Tally.
 */
export type TallyFieldRef = {
  fieldId: string
  /** The blocks' shared `groupUuid` — Tally's own identity for the question. */
  groupUuid?: string
  /** Option block uuid → the label we imported it as. */
  optionLabels: Record<string, string>
}

export type TallyParseResult = {
  form: EditorForm
  skipped: SkippedBlock[]
  refs: TallyFieldRef[]
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

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string)

/**
 * The same tree as HTML, keeping links.
 *
 * Used only for the thank-you page, which is the one place Tally content is
 * stored as rich text and read back as rich text (`successBody` is HTML). Real
 * thank-you pages are mostly a line of thanks plus links to social profiles, so
 * dropping the hrefs would lose the point of the page.
 *
 * Everything is escaped and only `href` survives — this is third-party content
 * rendered on our own success page, so nothing else from the attrs is trusted.
 */
export function richHtml(schema: unknown): string {
  if (typeof schema === "string") return esc(schema)
  if (!Array.isArray(schema)) return ""
  return schema.map(richHtmlNode).join("")
}

function richHtmlNode(node: unknown): string {
  if (typeof node === "string") return esc(node)
  if (!Array.isArray(node)) return ""
  const [content, attrs] = node
  const inner =
    typeof content === "string"
      ? esc(content)
      : Array.isArray(content)
        ? content.map(richHtmlNode).join("")
        : ""
  const href = readHref(attrs)
  // Only http(s): a javascript: or data: href here would be stored XSS.
  if (!href || !/^https?:\/\//i.test(href)) return inner
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
}

/**
 * A deterministic uuid from a string — same input, same id, every parse.
 *
 * This is what makes importing a form twice safe. Field ids are the primary
 * keys `saveAiForm` upserts on and `answers.fieldId` points at, so re-parsing
 * with fresh random ids would soft-delete every existing field and insert
 * replacements, orphaning the answers already imported against them. Seeded on
 * Tally's own block-group uuid, a second run lands on the same rows.
 *
 * Four 32-bit FNV-1a passes give 128 bits without a crypto dependency. These
 * are identities, not secrets — unguessability is not a requirement.
 */
export function stableId(seed: string): string {
  const parts: string[] = []
  for (let salt = 0; salt < 4; salt += 1) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    parts.push(h.toString(16).padStart(8, "0"))
  }
  const hex = parts.join("")
  // Shaped as a v4 uuid so it satisfies the uuid columns it becomes.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Attrs are a list of `[key, value]` pairs. */
function readHref(attrs: unknown): string | undefined {
  if (!Array.isArray(attrs)) return undefined
  for (const pair of attrs) {
    if (Array.isArray(pair) && pair[0] === "href" && typeof pair[1] === "string") return pair[1]
  }
  return undefined
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
const IGNORED = new Set(["DIVIDER", "CAPTCHA"])

const questionType = (b: TallyBlock): AiFieldType | undefined => {
  const base = QUESTION_TYPES[b.groupType ?? ""] ?? QUESTION_TYPES[b.type]
  // Tally has no separate multi-select type: a MULTIPLE_CHOICE question with
  // `allowMultiple` IS one. Reading only the block type turns a question that
  // accepts several answers into one that accepts a single answer — silently,
  // and the answers still import, so nothing looks wrong until a respondent
  // can't pick two things.
  if (base === "multiple_choice" && b.payload?.allowMultiple === true) return "multi_select"
  return base
}

/**
 * An image block's asset.
 *
 * Tally keeps it in `images[]`, not on the payload root — reading `url`/`src`
 * (which is what the shape of every other block suggests) finds nothing, and
 * the block imports as an image with no picture in it.
 */
function imageUrlOf(p: Record<string, unknown>): string | undefined {
  if (Array.isArray(p.images)) {
    for (const item of p.images) {
      const url = (item as { url?: unknown })?.url
      if (typeof url === "string" && url.trim()) return url.trim()
    }
  }
  return str(p.url) ?? str(p.src)
}

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
  if (type === "image") c.imageUrl = imageUrlOf(p)

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
export function parseTallyBlocks(
  blocks: TallyBlock[],
  formName?: string,
  /** Tally's form id. Given, every field gets a deterministic id — see stableId. */
  seed?: string,
): TallyParseResult {
  const newId = (key: string) => (seed ? stableId(`${seed}:${key}`) : genId())
  const fields: EditorField[] = []
  const skipped: SkippedBlock[] = []
  const refs: TallyFieldRef[] = []
  let title = formName?.trim() ?? ""
  let pendingTitle = ""
  let pendingDescription = ""
  let logoUrl: string | undefined
  let thankYou: { thankYouMessage?: string; successBody?: string } = {}

  // Conditional logic is a rule POINTING AT blocks, so it can only be resolved
  // once every block has become a field. Collected here, applied at the end.
  const logicBlocks: TallyBlock[] = []
  /** Every Tally block uuid → the field it ended up in. */
  const blockToField = new Map<string, string>()
  let pendingTitleUuid: string | undefined
  let pendingLabelUuid: string | undefined

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
      // The form's logo hangs off this block, not off settings.
      if (!logoUrl) logoUrl = str(p.logo)
      continue
    }
    if (b.type === "CONDITIONAL_LOGIC") {
      logicBlocks.push(b)
      continue
    }
    if (b.type === "TITLE") {
      pendingTitle = blockText(b)
      // A rule usually points at the TITLE block, not the input under it, so
      // this uuid has to end up owned by the question it labels.
      pendingTitleUuid = b.uuid
      continue
    }
    if (b.type === "LABEL") {
      pendingDescription = blockText(b)
      pendingLabelUuid = b.uuid
      continue
    }

    // Everything past Tally's thank-you break is the post-submit screen, not the
    // form. Importing those blocks as fields would turn a confirmation message
    // into trailing questions — so they go to the success page instead, which is
    // where they already belonged.
    if (b.type === "PAGE_BREAK" && p.isThankYouPage === true) {
      thankYou = parseThankYou(blocks.slice(i + 1))
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
      const contentId = newId(`content:${b.uuid ?? i}`)
      fields.push({
        id: contentId,
        type: content.type,
        label: carriesText ? text : "",
        required: false,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      })
      // Content blocks are legitimate logic targets — "show this paragraph if…".
      if (b.uuid) blockToField.set(b.uuid, contentId)
      pendingTitle = ""
      pendingDescription = ""
      pendingTitleUuid = undefined
      pendingLabelUuid = undefined
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
    //
    // The uuid of each option block is kept alongside its label because that is
    // what an API answer to a choice question contains — a uuid, not the text.
    const groupKey = b.groupUuid ?? `block:${b.uuid ?? i}`
    const options: FieldOption[] = []
    const optionLabels: Record<string, string> = {}
    for (const [index, o] of group.entries()) {
      if (o.payload?.isOtherOption === true) continue
      const label = str(o.payload?.text)
      if (!label) continue
      options.push({ id: newId(`${groupKey}:opt:${o.uuid ?? index}`), label })
      if (o.uuid) optionLabels[o.uuid] = label
    }

    const hasOther = group.some((o) => o.payload?.isOtherOption === true)
    const config = readConfig(type, p)
    if (hasOther) config.allowOther = true

    // The label lives on the TITLE block for most questions; a question built
    // without one keeps it in `payload.name` instead.
    const label = pendingTitle || str(p.name) || ""

    const fieldId = newId(groupKey)
    fields.push({
      id: fieldId,
      type,
      label,
      // A block Tally had hidden is imported, because the goal is to lose
      // nothing — but never as required. A hidden question the respondent
      // cannot see, which they must answer to submit, is an unsubmittable form.
      required: p.isRequired === true && p.isHidden !== true,
      ...(pendingDescription ? { description: pendingDescription } : {}),
      ...(str(p.placeholder) ? { placeholder: str(p.placeholder) } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
    })
    refs.push({ fieldId, groupUuid: b.groupUuid, optionLabels })

    // Every block that folded into this question — its title, its help text and
    // each of its option blocks — so a rule pointing at any of them lands here.
    for (const uuid of [pendingTitleUuid, pendingLabelUuid, ...group.map((g) => g.uuid)]) {
      if (uuid) blockToField.set(uuid, fieldId)
    }

    pendingTitle = ""
    pendingDescription = ""
    pendingTitleUuid = undefined
    pendingLabelUuid = undefined
  }

  applyConditionalLogic(logicBlocks, fields, refs, blockToField, skip)

  return {
    form: {
      title: title || "Imported form",
      fields,
      ...(Object.keys(thankYou).length > 0 ? { settings: thankYou } : {}),
      ...(logoUrl ? { theme: { logoUrl } } : {}),
    },
    skipped,
    refs,
  }
}

// ── Conditional logic ───────────────────────────────────────────────────────

/**
 * Tally's comparisons → ours.
 *
 * The ANY_OF pair map to the single-value operators because Tally only sends a
 * list when several answers are offered, and our condition holds one value —
 * the multi-value case is reported rather than silently narrowed.
 */
const COMPARISONS: Record<string, FieldCondition["operator"]> = {
  IS: "equals",
  EQUALS: "equals",
  IS_ANY_OF: "equals",
  IS_NOT: "not_equals",
  NOT_EQUALS: "not_equals",
  IS_NOT_ANY_OF: "not_equals",
  CONTAINS: "contains",
  DOES_NOT_CONTAIN: "not_contains",
  IS_EMPTY: "is_empty",
  IS_NOT_EMPTY: "is_not_empty",
  GREATER_THAN: "greater_than",
  IS_GREATER_THAN: "greater_than",
  LESS_THAN: "less_than",
  IS_LESS_THAN: "less_than",
}

const NO_VALUE = new Set(["is_empty", "is_not_empty"])

/**
 * Turn Tally's logic rules into per-field visibility.
 *
 * The models are the same idea from opposite ends. Tally's rule is a standalone
 * object — "if question X is Y, show blocks A and B" — while ours lives on the
 * block being controlled: "show me when question X is Y". So this inverts the
 * direction, writing one copy of the rule onto each block it pointed at.
 *
 * Only SHOW_BLOCKS and HIDE_BLOCKS survive. REQUIRE_ANSWER has no counterpart
 * — a question here is required or it isn't — and is reported by name so the
 * author knows which ones to look at rather than finding out from a respondent.
 */
function applyConditionalLogic(
  logicBlocks: TallyBlock[],
  fields: EditorField[],
  refs: TallyFieldRef[],
  blockToField: Map<string, string>,
  skip: (label: string, type: string) => void,
): void {
  if (logicBlocks.length === 0) return

  const fieldById = new Map(fields.map((f) => [f.id, f]))
  const fieldByGroup = new Map<string, string>()
  const optionsByField = new Map<string, Record<string, string>>()
  for (const ref of refs) {
    if (ref.groupUuid) fieldByGroup.set(ref.groupUuid, ref.fieldId)
    optionsByField.set(ref.fieldId, ref.optionLabels)
  }

  for (const rule of logicBlocks) {
    const p = rule.payload ?? {}
    const conditions = readConditions(p.conditionals, fieldByGroup, optionsByField)
    if (conditions.length === 0) continue

    // Tally only ever emits AND across a rule's conditions in practice, but it
    // names the operator, so read it rather than assume.
    const match = p.logicalOperator === "OR" ? "any" : "all"

    // One rule names several blocks of the SAME question — its title and its
    // input — which both resolve here to one field. Without this the rule would
    // look like it was competing with itself.
    const touched = new Set<string>()

    for (const raw of Array.isArray(p.actions) ? p.actions : []) {
      const action = raw as { type?: unknown; payload?: Record<string, unknown> }
      const kind = action.type

      if (kind === "REQUIRE_ANSWER") {
        // A single uuid, not a list. A target that no longer exists is a rule
        // left dangling in Tally, and there is nothing to tell the author.
        const uuid = action.payload?.requireAnswer
        const field =
          typeof uuid === "string" ? fieldById.get(blockToField.get(uuid) ?? "") : undefined
        if (field) skip(field.label || "a question", "Conditional required")
        continue
      }

      const targets =
        kind === "SHOW_BLOCKS"
          ? action.payload?.showBlocks
          : kind === "HIDE_BLOCKS"
            ? action.payload?.hideBlocks
            : null
      if (!targets) continue

      for (const uuid of asStrings(targets)) {
        const field = fieldById.get(blockToField.get(uuid) ?? "")
        if (!field || touched.has(field.id)) continue
        touched.add(field.id)

        // Our model holds one rule per field. Tally allows several rules to
        // point at one block, and two rules are an OR that a single `match`
        // cannot express — so the first wins and the rest are reported.
        if (field.logic) {
          skip(field.label || "a question", "Extra logic rule")
          continue
        }
        field.logic = {
          action: kind === "HIDE_BLOCKS" ? "hide" : "show",
          match,
          conditions,
          source: "manual",
        }
      }
    }
  }
}

/** Each SINGLE conditional we understand, as one of our conditions. */
function readConditions(
  conditionals: unknown,
  fieldByGroup: Map<string, string>,
  optionsByField: Map<string, Record<string, string>>,
): FieldCondition[] {
  const out: FieldCondition[] = []
  for (const raw of Array.isArray(conditionals) ? conditionals : []) {
    const node = raw as { type?: unknown; payload?: Record<string, unknown> }
    // Nested groups would need a condition tree; we have a flat list.
    if (node.type !== "SINGLE" || !node.payload) continue

    const source = node.payload.field as { blockGroupUuid?: unknown } | undefined
    const group = typeof source?.blockGroupUuid === "string" ? source.blockGroupUuid : ""
    const fieldId = fieldByGroup.get(group)
    if (!fieldId) continue

    const operator = COMPARISONS[String(node.payload.comparison ?? "")]
    if (!operator) continue

    if (NO_VALUE.has(operator)) {
      out.push({ fieldId, operator })
      continue
    }

    // The stored value is an option's uuid; our conditions compare labels,
    // which is also what the answer itself is stored as.
    const rawValue = node.payload.value
    if (Array.isArray(rawValue)) {
      // "is any of" with several choices needs an OR we cannot express here.
      if (rawValue.length !== 1) continue
    }
    const single = Array.isArray(rawValue) ? rawValue[0] : rawValue
    if (typeof single !== "string" && typeof single !== "number") continue

    const labels = optionsByField.get(fieldId) ?? {}
    const value = typeof single === "string" ? (labels[single] ?? single) : single
    if (value === "") continue

    out.push({ fieldId, operator, value })
  }
  return out
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

/**
 * Tally's thank-you page as our success page.
 *
 * `thankYouMessage` is the success page's heading and `successBody` its HTML
 * body, which maps onto how these pages are actually written: a short heading,
 * a paragraph or two, and usually a couple of linked social icons.
 *
 * A page with no heading leaves `thankYouMessage` unset rather than promoting
 * its first sentence — "Thank you for taking the time to share your thoughts
 * and feedback…" rendered at heading size would look like a mistake.
 */
export function parseThankYou(after: TallyBlock[]): {
  thankYouMessage?: string
  successBody?: string
} {
  let heading = ""
  const body: string[] = []

  for (const b of after) {
    const p = b.payload ?? {}

    if (b.type === "IMAGE") {
      const url = imageUrlOf(p)
      if (url && /^https?:\/\//i.test(url)) {
        body.push(`<p><img src="${esc(url)}" alt="" /></p>`)
      }
      continue
    }

    const isHeading = b.type.startsWith("HEADING")
    const html = richHtml(p.safeHTMLSchema).trim()
    if (!html) continue

    if (isHeading && !heading) {
      heading = richText(p.safeHTMLSchema).trim()
      continue
    }
    body.push(isHeading ? `<h2>${html}</h2>` : `<p>${html}</p>`)
  }

  return {
    ...(heading ? { thankYouMessage: heading } : {}),
    ...(body.length > 0 ? { successBody: body.join("\n") } : {}),
  }
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
