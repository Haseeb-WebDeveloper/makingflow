import { after } from "next/server"
import { generateObject, streamText, type ModelMessage } from "ai"
import { type AnswerValue } from "@/lib/db/schema"
import { loadFormDef, type PublicField } from "@/lib/data/public-form"
import { geminiFastModel } from "@/lib/ai/provider"
import { nextAnswerableField, isEmpty } from "@/lib/builder/logic"
import {
  parseSchema,
  coerceValue,
  buildParseSystem,
  buildParsePrompt,
  buildTurnSystem,
  buildTurnDirective,
  type PromptField,
  type TurnSituation,
} from "@/lib/ai/conversational"
import { incrementAiCalls } from "@/lib/usage/meter"
import type { TurnRequest, TurnMeta } from "@/lib/forms/conversation-types"

export const maxDuration = 30

/** Load + validate a published, AI-enabled conversational form. Null = not
 *  serveable in conversational mode (client falls back to classic). */
async function loadConversationalForm(publicId: string) {
  // Cached form definition (row + fields), shared with the public form page and
  // invalidated on edit/publish via the `form-${id}` tag. The definition never
  // changes mid-session, so back-to-back turns read it from cache instead of
  // making two round-trips to the (distant) DB on every answer.
  const def = await loadFormDef(publicId)
  if (!def) return null
  const { row: form, fields } = def
  if (form.status !== "published") return null
  const now = new Date()
  if (form.opensAt && form.opensAt > now) return null
  if (form.closesAt && form.closesAt < now) return null
  if (form.renderMode !== "conversational" || !form.aiEnabled) return null
  return { form, fields }
}

function toPromptField(f: PublicField): PromptField {
  return {
    type: f.type,
    label: f.label,
    description: f.description,
    options: f.options ?? undefined,
    required: f.required,
  }
}

/** Build the streamed phrasing response, attaching the structured turn meta. */
function turnResponse(
  persona: string | null,
  baseLanguage: string,
  situation: TurnSituation,
  transcript: TurnRequest["transcript"],
  meta: TurnMeta,
) {
  const messages: ModelMessage[] = []
  for (const t of (transcript ?? []).slice(-8)) {
    if (t?.text) messages.push({ role: t.role, content: t.text })
  }
  messages.push({ role: "user", content: buildTurnDirective(situation) })

  const result = streamText({
    model: geminiFastModel,
    system: buildTurnSystem(persona, baseLanguage),
    messages,
  })
  return result.toTextStreamResponse({
    headers: { "x-mf-turn": encodeURIComponent(JSON.stringify(meta)) },
  })
}

/**
 * One conversational turn. Deterministic ordering is owned here (via
 * `nextAnswerableField` over the client-provided answers) — the model only
 * parses the reply and phrases the next message. Any unrecoverable failure
 * returns 503 so the client gracefully degrades to the classic runtime.
 */
export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "ai_unavailable" }, { status: 503 })
  }

  let body: TurnRequest
  try {
    body = (await request.json()) as TurnRequest
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 })
  }
  if (!body?.publicId) return Response.json({ error: "bad_request" }, { status: 400 })

  const loaded = await loadConversationalForm(body.publicId)
  if (!loaded) return Response.json({ error: "unavailable" }, { status: 503 })
  const { form, fields } = loaded
  const persona = form.aiConfig?.persona ?? null
  const clarifyOn = form.aiConfig?.clarifyVagueAnswers ?? false
  const followOn = form.aiConfig?.followUpsEnabled ?? false
  const baseLanguage = form.baseLanguage

  const values: Record<string, AnswerValue> = { ...(body.values ?? {}) }
  const prev = body.prev
  let calls = 0

  let parsedFieldId: string | null = null
  let parsedValue: AnswerValue | null = null
  let language: string | null = null
  let followUpSuggestion: string | null = null
  let justHandled: string | null = null // ordering anchor
  let previousForAck: { label: string; reply: string } | undefined

  try {
    // ── 1) Interpret the previous expectation + the respondent's reply ──────
    if (prev?.expect.kind === "field") {
      const fieldId = prev.expect.fieldId
      const field = fields.find((f) => f.id === fieldId)
      if (field) {
        let vague = false
        if (prev.pillValue !== undefined) {
          parsedValue = prev.pillValue
        } else if (typeof prev.reply === "string" && prev.reply.trim()) {
          const r = await generateObject({
            model: geminiFastModel,
            schema: parseSchema,
            system: buildParseSystem(baseLanguage),
            prompt: buildParsePrompt(toPromptField(field), prev.reply),
          })
          calls++
          parsedValue = coerceValue(field.type, r.object.raw, field.options ?? undefined)
          language = r.object.language || null
          vague = r.object.vague
          followUpSuggestion = r.object.followUp
        }

        const cannotRecord = field.required && (parsedValue == null || isEmpty(parsedValue))
        const isFreeText = prev.pillValue === undefined
        if (
          isFreeText &&
          ((clarifyOn && vague) || cannotRecord) &&
          (body.clarifyCount ?? 0) < 2
        ) {
          // Re-ask the same field; record nothing.
          after(() => incrementAiCalls(form.workspaceId, calls))
          return turnResponse(
            persona,
            baseLanguage,
            { kind: "clarify", field: toPromptField(field), reply: prev.reply ?? "" },
            body.transcript,
            { action: "clarify", expect: { kind: "field", fieldId }, language },
          )
        }

        // Required answer still uncaptured after the clarify budget. Never strand
        // the respondent in chat (guardrail: a submission must never be blocked by
        // the AI layer) — hand off to the classic runtime, which resumes the
        // shared draft so they can complete the required fields and submit.
        if (cannotRecord && (body.clarifyCount ?? 0) >= 2) {
          after(() => incrementAiCalls(form.workspaceId, calls))
          return degradeResponse({
            action: "degrade",
            expect: { kind: "done" },
            parsedFieldId: null,
            parsedValue: null,
            language,
          })
        }

        parsedFieldId = field.id
        if (parsedValue != null && !isEmpty(parsedValue)) values[field.id] = parsedValue
        justHandled = field.id
        const ack = ackText(prev)
        if (ack) previousForAck = { label: field.label || "that", reply: ack }
      }
    } else if (prev?.expect.kind === "followup") {
      justHandled = prev.expect.afterFieldId
      if (prev.reply?.trim()) previousForAck = { label: prev.expect.question, reply: prev.reply }
    }

    // ── 2) Optional adaptive follow-up, right after a real field answer ──────
    if (
      prev?.expect.kind === "field" &&
      followOn &&
      followUpSuggestion &&
      followUpSuggestion.trim()
    ) {
      const q = followUpSuggestion.trim()
      after(() => incrementAiCalls(form.workspaceId, calls))
      return turnResponse(
        persona,
        baseLanguage,
        { kind: "followup", question: q },
        body.transcript,
        {
          action: "followup",
          expect: { kind: "followup", question: q, afterFieldId: justHandled },
          parsedFieldId,
          parsedValue,
          language,
        },
      )
    }

    // ── 3) Advance to the next visible field, or finish ─────────────────────
    const next = nextAnswerableField(fields, values, justHandled)
    let situation: TurnSituation
    let meta: TurnMeta
    if (next) {
      situation = prev
        ? {
            kind: "advance",
            previous: previousForAck ?? { label: "", reply: "" },
            ask: toPromptField(next),
          }
        : { kind: "opening", ask: toPromptField(next) }
      meta = {
        action: "advance",
        expect: { kind: "field", fieldId: next.id },
        parsedFieldId,
        parsedValue,
        language,
      }
    } else {
      situation = { kind: "done", previous: previousForAck }
      meta = {
        action: "done",
        expect: { kind: "done" },
        parsedFieldId,
        parsedValue,
        language,
      }
    }

    after(() => incrementAiCalls(form.workspaceId, calls))
    return turnResponse(persona, baseLanguage, situation, body.transcript, meta)
  } catch (err) {
    console.error("[forms/turn] failed", err)
    return Response.json({ error: "turn_failed" }, { status: 503 })
  }
}

/**
 * Hand-off response telling the client to finish in the classic runtime. No
 * model call — the short message is barely shown before the classic form swaps
 * in, so it stays fixed (and cheap) rather than phrased per language.
 */
function degradeResponse(meta: TurnMeta) {
  return new Response("Let's finish the last details as a quick form.", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-mf-turn": encodeURIComponent(JSON.stringify(meta)),
    },
  })
}

/** Human-readable text of what the respondent just answered (for the ack). */
function ackText(prev: NonNullable<TurnRequest["prev"]>): string | undefined {
  if (prev.reply?.trim()) return prev.reply.trim()
  if (prev.pillValue !== undefined) {
    return Array.isArray(prev.pillValue) ? prev.pillValue.join(", ") : String(prev.pillValue)
  }
  return undefined
}
