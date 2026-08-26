"use client"

import { useEffect, useRef, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Composer } from "@/components/builder/composer"
import { MemoizedMarkdown } from "@/components/forms/memoized-markdown"
import { Thinking } from "@/components/forms/thinking"
import type { FormChatMessage } from "@/lib/data/form-chat"

const INSIGHTS_PHRASES = ["Reading your responses…", "Crunching the numbers…", "Writing it up…"]

type Msg = {
  role: "user" | "assistant"
  text: string
  /** Who asked. Null for assistant turns, and for turns seeded before sign-in. */
  authorId?: string | null
  authorName?: string | null
}

/** The MakingFlow mark — brands the assistant as a first-class AI surface
 *  (matches the builder's assistant avatar) instead of a stock chat glyph. */
function AssistantMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo/logo.svg" alt="" className={className} />
}

const SUGGESTIONS = [
  "Summarize the submissions",
  "How many responses so far?",
  "What are the most common answers?",
]

/**
 * Form-scoped AI assistant in a side Sheet. Ask anything about the form or its
 * responses — summaries, counts, aggregates. Streams from /api/ai/insights and
 * renders the answer as memoized markdown so streaming stays smooth.
 *
 * The thread is durable and shared with the workspace: the server persists both
 * sides of every exchange, and `initialChat` seeds it back on load. Teammates
 * see each other's questions (attributed) after a reload — there is no realtime
 * sync, so two sheets open at once won't update each other live.
 */
export function FormAssistant({
  formId,
  formTitle,
  initialChat = [],
  viewerId,
}: {
  formId: string
  formTitle: string
  initialChat?: FormChatMessage[]
  viewerId?: string
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>(() =>
    initialChat.map((m) => ({
      role: m.role,
      text: m.text,
      authorId: m.authorId,
      authorName: m.authorName,
    })),
  )
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToEnd = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })

  // Radix mounts the sheet's content on open, so a seeded thread starts at the
  // top — jump to the newest turn, which is what the reader wants to see.
  useEffect(() => {
    if (open) scrollToEnd()
  }, [open])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput("")
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q, authorId: viewerId ?? null },
      { role: "assistant", text: "" },
    ])
    setBusy(true)
    scrollToEnd()

    try {
      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No history in the body — the server reads the shared thread it owns.
        body: JSON.stringify({ formId, question: q }),
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "")
        throw new Error(detail || `Request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: "assistant", text: acc }
          return next
        })
        scrollToEnd()
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong. Please try again."
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: "assistant", text: `⚠️ ${text}` }
        return next
      })
    } finally {
      setBusy(false)
      scrollToEnd()
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <AssistantMark className="size-4 shrink-0 object-contain" />
          Ask AI
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="shrink-0 gap-0.5 border-b border-border px-4 py-3 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <AssistantMark className="size-6 object-contain rounded" />
            Ask AI
          </SheetTitle>
          <SheetDescription className="text-xs">
            Summaries, counts, and trends across your responses.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10">
                <AssistantMark className="size-6 object-contain" />
              </span>
              <p className="max-w-xs text-sm text-muted-foreground">
                Ask the AI to summarize responses, count answers, or spot trends, instead of
                crunching it by hand.
              </p>
              <div className="flex flex-col items-stretch gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:border-foreground/30 hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex flex-col items-end gap-1">
                  {/* Only label other people — naming yourself on every turn is
                      noise in the common single-person case. */}
                  {m.authorName && m.authorId !== viewerId ? (
                    <span className="px-1 text-xs text-muted-foreground">{m.authorName}</span>
                  ) : null}
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-sm rounded-br bg-foreground px-3.5 py-2 text-sm text-background">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-sm rounded-bl bg-muted px-3.5 py-2.5">
                    {m.text ? (
                      <MemoizedMarkdown content={m.text} id={`msg-${i}`} />
                    ) : (
                      <Thinking phrases={INSIGHTS_PHRASES} />
                    )}
                  </div>
                </div>
              ),
            )
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3">
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => ask(input)}
            placeholder={`Ask about ${formTitle}…`}
            busy={busy}
            submitLabel=""
            rows={2}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

