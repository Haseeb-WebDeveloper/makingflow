"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { submitForm } from "@/lib/actions/submissions"
import type { PublicForm, PublicField } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"
import { isFieldVisible, NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic"
import { collectClientMeta, track } from "@/lib/forms/client-meta"
import { Control, Check, FormBranding } from "@/components/forms/field-control"
import { FormRuntime } from "@/components/forms/form-runtime"
import type { Expect, TurnMeta, TurnPrev, TurnRequest } from "@/lib/forms/conversation-types"
import { cn } from "@/lib/utils"

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
  const [resumed, setResumed] = useState(false)
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const resumeKey = `mf:resume:${form.publicId}`

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
  const scrollToEnd = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })

  // Clear the per-question input scaffolding (pill selection, file draft, text)
  // whenever we move to a new question. Called from applyMeta, not an effect.
  function resetInputScaffolding() {
    setMulti([])
    setFileDraft(undefined)
    setInput("")
  }

  // ── Partial save (shared draft + resume token, identical to classic) ───────
  function savePartialNow() {
    const payload = form.fields
      .filter(
        (f) =>
          !NON_ANSWER_TYPES.has(f.type) &&
          isFieldVisible(f.logic, valuesRef.current) &&
          !isEmpty(valuesRef.current[f.id]),
      )
      .map((f) => ({ fieldId: f.id, value: valuesRef.current[f.id]! }))
    if (payload.length === 0) return
    fetch("/api/partial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicId: form.publicId,
        submissionId: submissionIdRef.current,
        answers: payload,
      }),
      keepalive: true,
    })
      .then((r) => r.json().catch(() => null))
      .then((data) => {
        if (data?.submissionId) {
          submissionIdRef.current = data.submissionId
          try {
            localStorage.setItem(resumeKey, data.submissionId)
          } catch {
            /* storage blocked */
          }
        }
      })
      .catch(() => {})
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

    const boot = async () => {
      try {
        const saved = localStorage.getItem(resumeKey)
        if (saved) {
          submissionIdRef.current = saved
          const r = await fetch(
            `/api/partial?publicId=${encodeURIComponent(form.publicId)}&submissionId=${encodeURIComponent(saved)}`,
          )
          const d = r.ok ? await r.json() : null
          if (d?.values && Object.keys(d.values).length > 0) {
            valuesRef.current = d.values
            setValues(d.values)
            setResumed(true)
          }
        }
      } catch {
        /* ignore resume errors */
      }
      await runTurn(undefined)
    }
    void boot()

    const onHide = () => savePartialNow()
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      if (partialTimer.current) clearTimeout(partialTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.publicId])

  // Keep the thread pinned to the latest message (streaming text, new pills,
  // status changes) — the rAF nudges in runTurn cover mid-stream chunks; this
  // catches every committed render.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, status])

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
    clarifyRef.current = meta.action === "clarify" ? clarifyRef.current + 1 : 0

    expectRef.current = meta.expect
    setExpect(meta.expect)
    resetInputScaffolding()

    if (meta.action === "done") {
      if (!message.trim()) {
        // Defensive: ensure there's a closing line even if the model returned none.
        messagesRef.current = [
          ...messagesRef.current.slice(0, -1),
          { role: "assistant", text: "Thanks — recording your response." },
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
    send({ reply: text, display: text })
  }

  function degradeToClassic() {
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
    const res = await submitForm({
      publicId: form.publicId,
      answers: [...fieldAnswers, ...followUpAnswers],
      meta: collectClientMeta(),
      submissionId: submissionIdRef.current,
      language: submissionLangRef.current,
    })
    if (!res.success) {
      setError(res.error)
      setStatus("ready")
      return
    }
    try {
      localStorage.removeItem(resumeKey)
    } catch {
      /* ignore */
    }
    submissionIdRef.current = null
    if (form.redirectUrl) {
      window.location.href = form.redirectUrl
      return
    }
    setStatus("done")
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (aiDown) {
    // Graceful degradation: classic runtime resumes the shared draft.
    return <FormRuntime form={form} />
  }

  if (status === "done") {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <Check className="size-7" />
        </div>
        <h2 className="font-sebenta text-2xl font-bold tracking-tight text-foreground">
          {form.thankYou}
        </h2>
      </div>
    )
  }

  const showComposer = status === "ready" && (expect?.kind === "field" || expect?.kind === "followup")
  const composerDisabled = status !== "ready"

  return (
    <div className="flex h-[82dvh] flex-col overflow-hidden">
      <header className="shrink-0 pb-4">
        <FormBranding theme={form.theme} />
        <h1 className="font-sebenta text-lg font-bold tracking-tight text-foreground">
          {form.title}
        </h1>
      </header>

      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-0.5 py-2">
        {resumed ? (
          <div className="mx-auto w-fit rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            Picking up where you left off.
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-foreground">
                {m.text ? m.text : <Dots />}
              </div>
            </div>
          ),
        )}

        {/* Inline option pills under the latest assistant message. */}
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

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {status === "submitting" ? (
          <p className="text-center text-xs text-muted-foreground">Recording your response…</p>
        ) : null}
      </div>

      {showComposer && currentField?.type !== "file_upload" ? (
        <div className="shrink-0 pt-3">
          <div className="flex items-end gap-2">
            <textarea
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
              className="scrollbar-thin max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
            />
            <button
              type="button"
              onClick={sendTyped}
              disabled={composerDisabled || !input.trim()}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Made with{" "}
            <Link href="/" className="font-medium text-foreground hover:underline">
              MakingFlow
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** Tappable option pills for choice/numeric fields. Free typing stays available
 *  via the composer; tapping a pill sends the exact value (no AI parse). */
function Pills({
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
    "rounded-full border border-input px-3.5 py-1.5 text-sm text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"

  if (field.type === "yes_no") {
    return (
      <div className="flex flex-wrap justify-end gap-2">
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
      <div className="flex flex-wrap justify-end gap-2">
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
      <div className="flex flex-wrap justify-end gap-1.5">
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-full border border-input text-sm text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
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
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          {opts.map((o) => {
            const on = multi.includes(o.label)
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.label)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
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

function Dots() {
  return (
    <span className="inline-flex gap-1 py-1">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </span>
  )
}
