import type { AnswerValue } from "@/lib/db/schema"

/**
 * Wire types shared by the per-turn endpoint (`/api/forms/turn`) and the
 * conversational client. The server drives the state machine by telling the
 * client what the NEXT reply is for (`Expect`); the client echoes that back with
 * the user's reply so the server can interpret it — keeping the endpoint
 * stateless. Pure types only (no runtime imports) so both sides can import it.
 */

export type Expect =
  | { kind: "field"; fieldId: string }
  | { kind: "followup"; question: string; afterFieldId: string | null }
  | { kind: "done" }

export type TurnAction = "advance" | "clarify" | "followup" | "done" | "degrade"

/** Structured part of a turn response — carried in the `x-mf-turn` header
 *  (URI-encoded JSON); the body streams the natural-language message. */
export type TurnMeta = {
  action: TurnAction
  expect: Expect
  /** The field whose value was parsed this turn (if any) and the parsed value. */
  parsedFieldId?: string | null
  parsedValue?: AnswerValue | null
  /** Detected BCP-47 language of the respondent's reply. */
  language?: string | null
}

export type TurnPrev = {
  /** The expectation the server returned last turn. */
  expect: Expect
  /** Free-text reply (typed by the respondent). */
  reply?: string
  /** Exact value from a tapped option pill — skips the AI parse. */
  pillValue?: AnswerValue
}

export type TurnRequest = {
  publicId: string
  /** Field answers accumulated so far (client is the source of truth). */
  values: Record<string, AnswerValue>
  /** What the respondent just responded to. Omitted on the opening turn. */
  prev?: TurnPrev
  /** How many times the current field has already been re-asked (clarify cap). */
  clarifyCount?: number
  /** Recent chat turns, for tone continuity. */
  transcript?: { role: "user" | "assistant"; text: string }[]
}
