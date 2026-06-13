import { z } from "zod"
import type { AnswerValue } from "@/lib/db/schema"

/**
 * Conversational render mode — server-side AI helpers.
 *
 * The control flow is owned by the client + the server's deterministic
 * `nextAnswerableField`; the model only ever does two things per turn:
 *   1. PARSE a free-text reply into a field's typed value  (`parseSchema`)
 *   2. PHRASE the next message (ack + question) in persona/language (streamText)
 * Choice/number coercion is deterministic (`coerceValue`) so it's unit-testable
 * and never depends on the model returning perfectly-typed JSON.
 */

// ── Parse phase ────────────────────────────────────────────────────────────

export const parseSchema = z.object({
  /**
   * The respondent's answer expressed plainly, normalized to the form's base
   * language. For choice fields: the exact matching option label. For
   * multi-select: option labels separated by " | ". For rating/scale/nps: the
   * number only. Empty string if they didn't actually answer.
   */
  raw: z.string(),
  /** BCP-47 code of the language the respondent wrote in (e.g. "en", "it"). */
  language: z.string(),
  /** True when the reply is too vague/ambiguous to answer the field. */
  vague: z.boolean(),
  /** An optional natural follow-up worth asking about this answer, else null. */
  followUp: z.string().nullable(),
})

export type ParseResult = z.infer<typeof parseSchema>

type OptionLike = { label: string }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Match free text to one of the field's options: exact (case-insensitive)
 * first, then a whole-word/phrase appearance in the text. Whole-word (not bare
 * substring) avoids single-letter options like "A" false-matching on any text
 * that happens to contain that letter.
 */
export function matchOption(text: string, options?: OptionLike[] | null): string | null {
  if (!options || options.length === 0) return null
  const t = text.trim().toLowerCase()
  if (!t) return null
  const exact = options.find((o) => o.label.trim().toLowerCase() === t)
  if (exact) return exact.label
  for (const o of options) {
    const label = o.label.trim().toLowerCase()
    if (!label) continue
    const re = new RegExp(`(^|\\W)${escapeRegExp(label)}(\\W|$)`, "i")
    if (re.test(t)) return o.label
  }
  return null
}

/**
 * Turn the model's `raw` string into the field's typed AnswerValue. Returns null
 * when nothing usable could be extracted (caller decides to clarify or skip).
 */
export function coerceValue(
  type: string,
  raw: string,
  options?: OptionLike[] | null,
): AnswerValue | null {
  const text = (raw ?? "").trim()
  if (!text) return null

  switch (type) {
    case "rating":
    case "scale":
    case "nps": {
      const m = text.match(/-?\d+(?:\.\d+)?/)
      return m ? Number(m[0]) : null
    }
    case "yes_no": {
      // Compare the leading word (handles accented affirmatives like "sì").
      const lead = text.toLowerCase().match(/^\p{L}+/u)?.[0] ?? ""
      const yes = new Set([
        "y", "yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "true", "si", "sì", "oui", "ja",
      ])
      const no = new Set(["n", "no", "nope", "nah", "false", "non", "nein"])
      if (yes.has(lead)) return "Yes"
      if (no.has(lead)) return "No"
      return null
    }
    case "multiple_choice":
    case "dropdown":
      return matchOption(text, options) ?? text
    case "multi_select":
    case "checkboxes": {
      const parts = text
        .split(/\s*\|\s*|\s*,\s*|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean)
      const matched = parts
        .map((p) => matchOption(p, options))
        .filter((x): x is string => !!x)
      if (matched.length > 0) return Array.from(new Set(matched))
      const single = matchOption(text, options)
      return single ? [single] : []
    }
    default:
      return text
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────

export type PromptField = {
  type: string
  label: string
  description?: string | null
  options?: OptionLike[] | null
  required?: boolean
}

const DEFAULT_PERSONA =
  "warm, concise, and professional — like a helpful human assistant, not a robot"

export function buildParseSystem(baseLanguage: string): string {
  return [
    "You extract a structured answer from a respondent's free-text chat reply to a single form field.",
    `The form's base language is "${baseLanguage}". Always normalize the parsed answer (the "raw" field) to this base language, even if the respondent wrote in another language.`,
    'Set "language" to the BCP-47 code of the language the RESPONDENT actually wrote in.',
    'Set "vague" to true only when the reply does not actually answer the question (e.g. "I dunno", "maybe", off-topic).',
    'For choice fields, "raw" MUST be the exact option label provided. For multi-select, join chosen labels with " | ". For rating/scale/NPS, "raw" is just the number.',
    'Only suggest a "followUp" when a short natural follow-up would genuinely add value; otherwise null.',
  ].join("\n")
}

export function buildParsePrompt(field: PromptField, reply: string): string {
  const lines: string[] = [
    `Field label: ${field.label || "(untitled)"}`,
    `Field type: ${field.type}`,
  ]
  if (field.description) lines.push(`Field help text: ${field.description}`)
  if (field.options && field.options.length > 0) {
    lines.push(`Allowed options: ${field.options.map((o) => o.label).join(" | ")}`)
  }
  lines.push("", `Respondent reply: """${reply}"""`)
  return lines.join("\n")
}

export function buildTurnSystem(persona: string | null, baseLanguage: string): string {
  return [
    "You are guiding a respondent through a form ONE question at a time, as a friendly chat.",
    `Tone / persona: ${persona?.trim() || DEFAULT_PERSONA}.`,
    "Rules:",
    "- Write a single short chat message. Never ask more than one question.",
    "- When given a previous answer, acknowledge it briefly and naturally before asking the next question.",
    "- Ask EXACTLY the question you are told to ask. Do not invent, merge, or skip questions.",
    "- Do not restate the option list verbatim unless it helps; the UI shows selectable options separately.",
    `- Reply in the SAME language the respondent has been using; if unknown, use the base language "${baseLanguage}".`,
    "- Keep it human and warm. No markdown headers, no bullet lists — just a sentence or two.",
  ].join("\n")
}

export type TurnSituation =
  | { kind: "opening"; ask: PromptField }
  | { kind: "advance"; previous: { label: string; reply: string }; ask: PromptField }
  | { kind: "clarify"; field: PromptField; reply: string }
  | { kind: "followup"; question: string }
  | { kind: "done"; previous?: { label: string; reply: string } }

function describeField(f: PromptField): string {
  const bits = [`"${f.label || "(untitled)"}" (type: ${f.type})`]
  if (f.description) bits.push(`help: ${f.description}`)
  if (f.options && f.options.length > 0) {
    bits.push(`options: ${f.options.map((o) => o.label).join(" | ")}`)
  }
  return bits.join("; ")
}

/** The per-turn instruction for the phrasing (streamText) call. */
export function buildTurnDirective(s: TurnSituation): string {
  switch (s.kind) {
    case "opening":
      return `Greet the respondent in one short sentence, then ask the first question: ${describeField(s.ask)}.`
    case "advance":
      return `The respondent answered "${s.previous.label}" with: "${s.previous.reply}". Briefly acknowledge that, then ask the next question: ${describeField(s.ask)}.`
    case "clarify":
      return `The respondent's reply to "${s.field.label}" ("${s.reply}") wasn't clear enough to record. Gently ask them to clarify so you can answer this ${s.field.type} question. ${s.field.options && s.field.options.length > 0 ? `Remind them of the options: ${s.field.options.map((o) => o.label).join(", ")}.` : ""}`.trim()
    case "followup":
      return `Ask this follow-up question conversationally: "${s.question}".`
    case "done":
      return s.previous
        ? `The respondent just answered "${s.previous.label}" with: "${s.previous.reply}". Acknowledge it, then warmly let them know that's the last question and you're recording their response.`
        : `Warmly let the respondent know that's everything and you're recording their response.`
  }
}
