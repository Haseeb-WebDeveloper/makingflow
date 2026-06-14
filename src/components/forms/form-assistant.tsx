"use client"

import { useRef, useState } from "react"
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

type Msg = { role: "user" | "assistant"; text: string }

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
 */
export function FormAssistant({ formId, formTitle }: { formId: string; formTitle: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToEnd = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput("")
    const history = messages
    setMessages([...history, { role: "user", text: q }, { role: "assistant", text: "" }])
    setBusy(true)
    scrollToEnd()

    try {
      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formId, question: q, history }),
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
          className="inline-flex h-9 lg:h-[2.5vw] shrink-0 items-center gap-1.5 lg:gap-[0.417vw] rounded-md lg:rounded-[0.556vw] border border-border px-3 lg:px-[0.833vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <AssistantMark className="size-4 lg:size-[1.111vw] shrink-0 object-contain" />
          Ask AI
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="shrink-0 gap-0.5 lg:gap-[0.139vw] border-b border-border px-4 lg:px-[1.111vw] py-3 lg:py-[0.833vw] pr-12 lg:pr-[3.333vw]">
          <SheetTitle className="flex items-center gap-2 lg:gap-[0.556vw] text-base lg:text-[1.111vw]">
            <AssistantMark className="size-6 lg:size-[1.667vw] object-contain rounded lg:rounded-[0.324vw]" />
            Ask AI
          </SheetTitle>
          <SheetDescription className="text-xs lg:text-[0.833vw]">
            Summaries, counts, and trends across your responses.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 lg:space-y-[1.111vw] overflow-y-auto px-4 lg:px-[1.111vw] py-4 lg:py-[1.111vw]">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 lg:gap-[1.111vw] text-center">
              <span className="grid size-11 lg:size-[3.056vw] place-items-center rounded-xl lg:rounded-[0.926vw] bg-primary/10">
                <AssistantMark className="size-6 lg:size-[1.667vw] object-contain" />
              </span>
              <p className="max-w-xs lg:max-w-[22.222vw] text-sm lg:text-[0.972vw] text-muted-foreground">
                Ask the AI to summarize responses, count answers, or spot trends — instead of
                crunching it by hand.
              </p>
              <div className="flex flex-col items-stretch gap-1.5 lg:gap-[0.417vw]">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-lg lg:rounded-[0.694vw] border border-border px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-foreground transition-colors hover:border-foreground/30 hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl lg:rounded-[1.111vw] rounded-br-md lg:rounded-br-[0.556vw] bg-foreground px-3.5 lg:px-[0.972vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-background">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl lg:rounded-[1.111vw] rounded-bl-md lg:rounded-bl-[0.556vw] bg-muted px-3.5 lg:px-[0.972vw] py-2.5 lg:py-[0.694vw]">
                    {m.text ? (
                      <MemoizedMarkdown content={m.text} id={`msg-${i}`} />
                    ) : (
                      <Dots />
                    )}
                  </div>
                </div>
              ),
            )
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3 lg:p-[0.833vw]">
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

function Dots() {
  return (
    <span className="inline-flex gap-1 lg:gap-[0.278vw] py-1 lg:py-[0.278vw]">
      <span className="size-1.5 lg:size-[0.417vw] animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
      <span className="size-1.5 lg:size-[0.417vw] animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
      <span className="size-1.5 lg:size-[0.417vw] animate-bounce rounded-full bg-muted-foreground" />
    </span>
  )
}
