"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { submitForm } from "@/lib/actions/submissions"
import type { PublicForm, PublicField } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"
import { isFieldVisible, NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic"
import {
  collectClientMeta,
  track,
  readDraftToken,
  writeDraftToken,
  clearDraftToken,
} from "@/lib/forms/client-meta"
import { formatDistanceToNow } from "date-fns"
import { Control, Check, FormBranding } from "@/components/forms/field-control"
import { SuccessContent } from "@/components/forms/success-content"
import { SVGIcon } from "@/components/ui/svg-icon"
import { FormRuntime } from "@/components/forms/form-runtime"
import type { Expect, TurnMeta, TurnPrev, TurnRequest } from "@/lib/forms/conversation-types"
import { cn } from "@/lib/utils"
import { Thinking } from "@/components/forms/thinking"
import { SuccessMark } from "@/components/forms/success-mark"

// Status lines for the "AI is composing this turn" indicator. Exported so the
// /sandbox preview shows the real copy.
export const CONVERSATION_OPENING_PHRASES = ["Getting things ready…", "One moment…"]
export const CONVERSATION_REPLY_PHRASES = [
  "Reading your answer…",
  "Thinking…",
  "Lining up the next question…",
]

type ChatMessage = { role: "assistant" | "user"; text: string }

/** Field types that get tappable option pills (still typeable as free text). */
const SINGLE_PILL_TYPES = new Set(["multiple_choice", "dropdown", "yes_no"])
const MULTI_PILL_TYPES = new Set(["multi_select", "checkboxes"])
const NUMERIC_PILL_TYPES = new Set(["rating", "scale", "nps"])

/**
 * Conversational render mode — the AI asks one question at a time in a chat, the
 * respondent answers in natural language (or taps option pills), and the server
 * parses each reply into the field's typed value. Ordering, conditional logic,
 * required rules, partial-save and final submit are identical to the classic
 * runtime — only the front-end differs.
 *
 * Graceful degradation: if the per-turn AI endpoint ever fails, we fall back to
 * the classic FormRuntime, which resumes the chat-collected answers from the
 * shared partial-save draft so nothing is lost and submission is never blocked.
 */
export function ConversationalRuntime({ form }: { form: PublicForm }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [expect, setExpect] = useState<Expect | null>(null)
  const [, setValues] = useState<Record<string, AnswerValue>>({})
  const [status, setStatus] = useState<"booting" | "thinking" | "ready" | "submitting" | "done">(
    "booting",
  )
  const [aiDown, setAiDown] = useState(false)
  // A draft found in storage but NOT yet applied — the respondent is asked
  // before anything is restored (see the resume prompt below).
  const [pendingDraft, setPendingDraft] = useState<{
    id: string
    savedAt: number
    values: Record<string, AnswerValue>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [multi, setMulti] = useState<string[]>([])
  const [fileDraft, setFileDraft] = useState<AnswerValue | undefined>(undefined)

  // Refs read inside async turn handling (avoid stale closures).
  const valuesRef = useRef<Record<string, AnswerValue>>({})
  const expectRef = useRef<Expect | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const followUpsRef = useRef<{ question: string; value: AnswerValue }[]>([])
  const langMetaRef = useRef<Record<string, { originalValue: AnswerValue; originalLanguage: string }>>({})
  const submissionLangRef = useRef<string | null>(null)
  const submissionIdRef = useRef<string | null>(null)
  const clarifyRef = useRef(0)
  const startedRef = useRef(false)
  const bootedRef = useRef(false)
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Set once this runtime must stop writing drafts: after a successful submit,
  // and on hand-off to the classic runtime (which owns the draft from then on).
  // Without it the `pagehide` listener below — which outlives both events,
  // since this component stays mounted in either case — re-posted the full
  // answer set as a brand-new partial row.
  const doneRef = useRef(false)

  const fieldById = useMemo(
    () => new Map(form.fields.map((f) => [f.id, f])),
    [form.fields],
  )
  const currentField =
    expect?.kind === "field" ? fieldById.get(expect.fieldId) ?? null : null

  const pushMessage = (m: ChatMessage) => {
    messagesRef.current = [...messagesRef.current, m]
    setMessages(messagesRef.current)
    scrollToEnd()
  }
  // The whole page scrolls (no inner scroll container) — pin the window to the
  // bottom so the latest message stays in view as the AI streams.
  const scrollToEnd = () =>
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight })
    })

  // Clear the per-question input scaffolding (pill selection, file draft, text)
  // whenever we move to a new question. Called from applyMeta, not an effect.
  function resetInputScaffolding() {
    setMulti([])
    setFileDraft(undefined)
    setInput("")
  }

  // ── Partial save (shared draft + resume token, identical to classic) ───────
  // Returns a promise so callers that must not race the write — notably the
  // degrade hand-off, which passes the draft straight to the classic runtime —
  // can await it.
  async function savePartialNow(): Promise<void> {
    if (doneRef.current) return
    const payload = form.fields
      .filter(
        (f) =>
          !NON_ANSWER_TYPES.has(f.type) &&
          isFieldVisible(f.logic, valuesRef.current) &&
          !isEmpty(valuesRef.current[f.id]),
      )
      .map((f) => ({ fieldId: f.id, value: valuesRef.current[f.id]! }))
    if (payload.length === 0) return
    try {
      const res = await fetch("/api/partial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicId: form.publicId,
          submissionId: submissionIdRef.current,
          answers: payload,
        }),
        keepalive: true,
      })
      const data = await res.json().catch(() => null)
      if (data?.submissionId) {
        submissionIdRef.current = data.submissionId
        writeDraftToken(form.publicId, data.submissionId)
      }
    } catch {
      /* best-effort */
    }
  }
  function schedulePartialSave() {
    if (partialTimer.current) clearTimeout(partialTimer.current)
    partialTimer.current = setTimeout(savePartialNow, 1200)
  }

  // ── Boot: track view, restore any draft, then open the conversation ────────
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    track(form.publicId, "view")

    // Offer a saved draft rather than applying it: the token is keyed by form,
    // not by person, so on a shared device it may belong to someone else. The
    // conversation only opens once the respondent has chosen.
    const boot = async () => {
      const token = readDraftToken(form.publicId) // null when missing or stale
      if (token) {
        try {
          const r = await fetch(
            `/api/partial?publicId=${encodeURIComponent(form.publicId)}&submissionId=${encodeURIComponent(token.id)}`,
          )
          const d = r.ok ? await r.json() : null
          if (d?.values && Object.keys(d.values).length > 0) {
            setPendingDraft({ id: token.id, savedAt: token.savedAt, values: d.values })
            return // continueDraft / startFresh opens the conversation
          }
          clearDraftToken(form.publicId) // gone server-side — stop offering it
        } catch {
          /* unreachable draft — just start a fresh conversation */
        }
      }
      await runTurn(undefined)
    }
    void boot()

    const onHide = () => void savePartialNow()
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      if (partialTimer.current) clearTimeout(partialTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.publicId])

  // Keep the page pinned to the latest message (streaming text, new pills,
  // status changes) — the rAF nudges in runTurn cover mid-stream chunks; this
  // catches every committed render.
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight })
  }, [messages, status])

  // Auto-grow the answer box: rest at one line, expand with content up to a few
  // lines, then scroll. CSS min/max-height bound it.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  // ── One turn: stream the assistant message, then apply the structured meta ──
  async function runTurn(prev: TurnPrev | undefined) {
    setStatus("thinking")
    setError(null)
    pushMessage({ role: "assistant", text: "" }) // typing bubble
    try {
      const res = await fetch("/api/forms/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicId: form.publicId,
          values: valuesRef.current,
          prev,
          clarifyCount: clarifyRef.current,
          transcript: messagesRef.current.filter((m) => m.text).slice(-8),
        } satisfies TurnRequest),
      })
      if (!res.ok || !res.body) throw new Error(`turn ${res.status}`)
      const metaRaw = res.headers.get("x-mf-turn")
      if (!metaRaw) throw new Error("missing turn meta")
      const meta = JSON.parse(decodeURIComponent(metaRaw)) as TurnMeta

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        messagesRef.current = [
          ...messagesRef.current.slice(0, -1),
          { role: "assistant", text: acc },
        ]
        setMessages(messagesRef.current)
        scrollToEnd()
      }
      applyMeta(meta, prev, acc)
    } catch (err) {
      console.error("[conversational] turn failed — degrading to classic", err)
      degradeToClassic()
    }
  }

  function applyMeta(meta: TurnMeta, prev: TurnPrev | undefined, message: string) {
    // Record the parsed field value (e.g. "yeah ~4 stars" -> 4).
    if (meta.parsedFieldId && meta.parsedValue != null && !isEmpty(meta.parsedValue)) {
      const id = meta.parsedFieldId
      valuesRef.current = { ...valuesRef.current, [id]: meta.parsedValue }
      setValues(valuesRef.current)
      if (meta.language && meta.language !== form.baseLanguage && prev?.reply?.trim()) {
        langMetaRef.current[id] = {
          originalValue: prev.reply,
          originalLanguage: meta.language,
        }
      }
    }
    if (meta.language) submissionLangRef.current = meta.language

    if (meta.action === "degrade") {
      // The server couldn't capture a required answer in chat. Persist progress,
      // then hand off to the classic runtime so the respondent can finish and
      // submit — a submission is never blocked by the AI layer.
      //
      // AWAIT the save: this used to be fire-and-forget, and the classic runtime
      // would fetch the shared draft before the write landed (or before the row
      // existed at all, on the first save), resuming empty and losing the whole
      // conversation. The answers are also passed in-process below, so the
      // hand-off no longer depends on that round-trip at all.
      void savePartialNow().then(() => degradeToClassic())
      return
    }

    clarifyRef.current = meta.action === "clarify" ? clarifyRef.current + 1 : 0

    expectRef.current = meta.expect
    setExpect(meta.expect)
    resetInputScaffolding()

    if (meta.action === "done") {
      if (!message.trim()) {
        // Defensive: ensure there's a closing line even if the model returned none.
        messagesRef.current = [
          ...messagesRef.current.slice(0, -1),
          { role: "assistant", text: "Thanks, recording your response." },
        ]
        setMessages(messagesRef.current)
      }
      void finish()
    } else {
      setStatus("ready")
      schedulePartialSave()
    }
  }

  // ── Sending a reply (typed free text, a pill tap, or a staged value) ───────
  function send(payload: { reply?: string; pillValue?: AnswerValue; display: string }) {
    if (status !== "ready") return
    const cur = expectRef.current
    if (!cur || cur.kind === "done") return
    pushMessage({ role: "user", text: payload.display })
    if (!startedRef.current) {
      startedRef.current = true
      track(form.publicId, "start")
    }
    // A reply to an AI follow-up is stored verbatim (it maps to no form field).
    if (cur.kind === "followup") {
      const v =
        payload.reply ?? (payload.pillValue != null ? String(payload.pillValue) : "")
      if (v.trim()) {
        followUpsRef.current = [...followUpsRef.current, { question: cur.question, value: v }]
      }
    }
    void runTurn({ expect: cur, reply: payload.reply, pillValue: payload.pillValue })
  }

  function sendTyped() {
    const text = input.trim()
    if (!text) return
    // Clear the box the instant the message is sent — it already shows as a
    // chat bubble, so leaving the (often long) text sitting in the input reads
    // as "not sent". The next-question reset still runs later via applyMeta.
    setInput("")
    send({ reply: text, display: text })
  }

  /** Resume prompt — "Continue": adopt the draft, then open the conversation.
   *  The turn endpoint skips already-answered fields, so it lands on the first
   *  unanswered question by itself. */
  function continueDraft() {
    if (!pendingDraft) return
    submissionIdRef.current = pendingDraft.id
    valuesRef.current = pendingDraft.values
    setValues(pendingDraft.values)
    setPendingDraft(null)
    void runTurn(undefined)
  }

  /** Resume prompt — "Start fresh": abandon the draft (the row stays as real
   *  drop-off data) and start a new conversation. */
  function startFresh() {
    clearDraftToken(form.publicId)
    submissionIdRef.current = null
    setPendingDraft(null)
    void runTurn(undefined)
  }

  function degradeToClassic() {
    // The classic runtime owns the draft from here — this one must stop writing
    // to it, or its unload saver would post the chat answers back as a new row
    // after the classic form has already submitted them.
    doneRef.current = true
    setAiDown(true)
  }

  // ── Final submit (same action + payload semantics as classic) ──────────────
  async function finish() {
    setStatus("submitting")
    const fieldAnswers = form.fields
      .filter(
        (f) =>
          !NON_ANSWER_TYPES.has(f.type) &&
          isFieldVisible(f.logic, valuesRef.current) &&
          !isEmpty(valuesRef.current[f.id]),
      )
      .map((f) => ({
        fieldId: f.id,
        value: valuesRef.current[f.id]!,
        ...(langMetaRef.current[f.id] ?? {}),
      }))
    const followUpAnswers = followUpsRef.current.map((fu) => ({
      fieldId: null,
      value: fu.value,
      isAiFollowUp: true,
      question: fu.question,
      type: "long_text",
    }))

    if (partialTimer.current) clearTimeout(partialTimer.current)
    // The action handles its own errors, but the CALL rejects on transport
    // failure (offline, dropped tunnel, throttled mobile tab). Unhandled, that
    // rejection leaves status stuck on "submitting" — "Recording your response…"
    // forever, with the whole conversation unsent.
    let res: Awaited<ReturnType<typeof submitForm>>
    try {
      res = await submitForm({
        publicId: form.publicId,
        answers: [...fieldAnswers, ...followUpAnswers],
        meta: collectClientMeta(),
        submissionId: submissionIdRef.current,
        language: submissionLangRef.current,
      })
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.")
      setStatus("ready")
      return
    }
    if (!res.success) {
      setError(res.error)
      setStatus("ready")
      return
    }
    // Recorded. Latch this BEFORE the redirect below (which fires `pagehide`)
    // so the unload saver can never re-post these answers as a new draft.
    doneRef.current = true
    valuesRef.current = {}
    clearDraftToken(form.publicId)
    submissionIdRef.current = null
    if (form.redirectUrl) {
      window.location.href = form.redirectUrl
      return
    }
    setStatus("done")
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Asked before the conversation opens and before any saved answer is shown —
  // the draft may belong to whoever used this browser last.
  if (pendingDraft) {
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center">
        <div className="w-full rounded-lg border border-border bg-background p-6 sm:p-8">
          {form.title ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {form.title}
            </p>
          ) : null}
          <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">
            Continue where you left off?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We saved an unfinished response from{" "}
            {formatDistanceToNow(pendingDraft.savedAt, { addSuffix: true })}. If this
            isn&apos;t yours, start fresh.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={startFresh}
              className="h-11 rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Start fresh
            </button>
            <button
              type="button"
              onClick={continueDraft}
              autoFocus
              className="h-11 rounded-md bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (aiDown) {
    // Graceful degradation. Everything the conversation collected is handed
    // over directly — the parsed field values, the draft row they belong to,
    // the AI follow-up answers (which map to no form field and would otherwise
    // be dropped), and the per-answer original text/language. Nothing here
    // depends on the classic runtime re-fetching the shared draft.
    return (
      <FormRuntime
        form={form}
        initialValues={valuesRef.current}
        initialSubmissionId={submissionIdRef.current}
        extraAnswers={followUpsRef.current.map((fu) => ({
          fieldId: null,
          value: fu.value,
          isAiFollowUp: true,
          question: fu.question,
          type: "long_text",
        }))}
        answerMeta={langMetaRef.current}
        language={submissionLangRef.current}
      />
    )
  }

  if (status === "done") {
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <SuccessMark className="size-52" />
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          {form.thankYou}
        </h2>
        <SuccessContent
          body={form.successBody}
          videoUrl={form.successVideoUrl}
          className="mt-6 w-full"
        />
      </div>
    )
  }

  // The composer stays mounted (disabled) while the AI is responding, so the
  // input never disappears mid-conversation. File-upload questions answer via
  // the inline control instead.
  const showComposer =
    (expect?.kind === "field" && currentField?.type !== "file_upload") ||
    expect?.kind === "followup"
  const composerDisabled = status !== "ready"

  return (
    // The page itself scrolls (no inner scroll container). Bottom padding clears
    // the viewport-fixed composer so the last message is never hidden behind it.
    <div className={cn(showComposer ? "pb-40" : "pb-10")}>
      <header className="pb-3">
        <FormBranding theme={form.theme} />
        <h1 className="text-lg font-bold tracking-tight text-foreground">
          {form.title}
        </h1>
      </header>

      <div className="space-y-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-sm rounded-br bg-foreground px-3.5 py-2 text-sm text-background">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] whitespace-pre-wrap rounded-sm rounded-bl bg-muted px-3.5 py-2.5 text-sm text-foreground">
                {m.text ? (
                  m.text
                ) : (
                  <Thinking
                    phrases={
                      messages[i - 1]?.role !== "user"
                        ? CONVERSATION_OPENING_PHRASES
                        : CONVERSATION_REPLY_PHRASES
                    }
                  />
                )}
              </div>
            </div>
          ),
        )}

        {/* Suggested answers under the latest question — left-aligned, like the assistant. */}
        {status === "ready" && currentField ? (
          <Pills field={currentField} multi={multi} setMulti={setMulti} onSend={send} />
        ) : null}

        {status === "ready" && currentField?.type === "file_upload" ? (
          <div className="space-y-2">
            <Control
              field={currentField}
              value={fileDraft}
              invalid={false}
              onChange={(v) => setFileDraft(v)}
            />
            <button
              type="button"
              disabled={fileDraft == null || isEmpty(fileDraft)}
              onClick={() => send({ pillValue: fileDraft!, display: "📎 File attached" })}
              className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              Send
            </button>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            {/* A failed submit happens at expect.kind === "done", where the
                composer is hidden — without this the respondent is stranded
                with an error and no control at all, and everything since the
                last partial save is lost. The answers are still in memory, so
                retrying just re-runs finish(). */}
            {expect?.kind === "done" && status === "ready" ? (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  void finish()
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {status === "submitting" ? (
          <p className="text-center text-xs text-muted-foreground">Recording your response…</p>
        ) : null}
      </div>

      {showComposer ? (
        <div className="fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-canvas via-canvas to-transparent pt-8">
          <div className="mx-auto w-full max-w-2xl px-4 pb-5 sm:px-6">
            <div className="rounded-2xl border border-border bg-background p-2.5 shadow-sm transition-colors focus-within:border-foreground/30">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                disabled={composerDisabled}
                placeholder="Type your answer…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    sendTyped()
                  }
                }}
                style={{ maxHeight: "7.5rem" }}
                className="thin-scroll block w-full resize-none border-0 bg-transparent px-2 pt-1 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              <div className="flex items-center justify-end pl-1 pr-0.5 pt-1">
                <button
                  type="button"
                  onClick={sendTyped}
                  disabled={composerDisabled || !input.trim()}
                  aria-label="Send"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <SVGIcon src="/icons/arrow-up.svg" className="size-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Tappable option pills for choice/numeric fields. Free typing stays available
 *  via the composer; tapping a pill sends the exact value (no AI parse). */
export function Pills({
  field,
  multi,
  setMulti,
  onSend,
}: {
  field: PublicField
  multi: string[]
  setMulti: (v: string[]) => void
  onSend: (p: { reply?: string; pillValue?: AnswerValue; display: string }) => void
}) {
  const pill =
    "rounded-md border border-input px-3.5 py-1.5 text-sm text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"

  if (field.type === "yes_no") {
    return (
      <div className="flex flex-wrap justify-start gap-2">
        {["Yes", "No"].map((o) => (
          <button key={o} type="button" className={pill} onClick={() => onSend({ pillValue: o, display: o })}>
            {o}
          </button>
        ))}
      </div>
    )
  }

  if (SINGLE_PILL_TYPES.has(field.type)) {
    const opts = field.options ?? []
    if (opts.length === 0) return null
    return (
      <div className="flex flex-wrap justify-start gap-2">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            className={pill}
            onClick={() => onSend({ pillValue: o.label, display: o.label })}
          >
            {o.label}
          </button>
        ))}
      </div>
    )
  }

  if (NUMERIC_PILL_TYPES.has(field.type)) {
    const from = field.type === "nps" ? 0 : 1
    const to = field.type === "nps" ? 10 : 5
    const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i)
    return (
      <div className="flex flex-wrap justify-start gap-1.5">
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md border border-input text-sm text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
            onClick={() => onSend({ pillValue: n, display: String(n) })}
          >
            {n}
          </button>
        ))}
      </div>
    )
  }

  if (MULTI_PILL_TYPES.has(field.type)) {
    const opts = field.options ?? []
    if (opts.length === 0) return null
    const toggle = (label: string) =>
      setMulti(multi.includes(label) ? multi.filter((v) => v !== label) : [...multi, label])
    return (
      <div className="flex flex-col items-start gap-2">
        <div className="flex flex-wrap justify-start gap-2">
          {opts.map((o) => {
            const on = multi.includes(o.label)
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.label)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm transition-colors",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-input text-foreground hover:border-foreground/40 hover:bg-muted",
                )}
              >
                {on ? <Check className="size-3" /> : null}
                {o.label}
              </button>
            )
          })}
        </div>
        {multi.length > 0 ? (
          <button
            type="button"
            onClick={() => onSend({ pillValue: multi, display: multi.join(", ") })}
            className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
          >
            Done
          </button>
        ) : null}
      </div>
    )
  }

  return null
}

