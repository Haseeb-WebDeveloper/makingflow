"use client"

import { useRef, useState } from "react"
import { Icon } from "@/components/ui/icon"
import { Composer } from "@/components/builder/composer"
import { cn } from "@/lib/utils"

type Msg = { role: "user" | "assistant"; text: string }

/**
 * Floating, form-scoped AI assistant. Ask anything about the form or its
 * responses — summaries, counts, aggregates — instead of crunching them by
 * hand. Streams the answer from /api/ai/insights with the form's structure and
 * submissions as context. The input reuses the shared Composer so it matches
 * the new-form prompt box exactly.
 */
export function FormAssistant({
  formId,
  formTitle,
}: {
  formId: string
  formTitle: string
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
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
    setOpen(true)
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
      const text =
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: "assistant", text: `⚠ ${text}` }
        return next
      })
    } finally {
      setBusy(false)
      scrollToEnd()
    }
  }

  const hasThread = messages.length > 0

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 flex justify-center px-4 pb-5">
      <div className="pointer-events-auto w-full max-w-2xl">
        {open && hasThread ? (
          <div className="mb-2 overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Icon name="chat" className="size-4 text-primary" />
                Ask AI
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse"
                className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Icon name="close-square" className="size-4" />
              </button>
            </div>
            <div
              ref={scrollRef}
              className="scrollbar-thin max-h-[46vh] space-y-3 overflow-y-auto px-3.5 py-3"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "text-sm",
                    m.role === "user" ? "flex justify-end" : "flex justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2",
                      m.role === "user"
                        ? "bg-foreground text-background"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.text || (busy && i === messages.length - 1 ? "Thinking…" : "")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {hasThread && !open ? (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Show conversation
            </button>
          </div>
        ) : null}

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => ask(input)}
          placeholder={`Ask AI about ${formTitle}…`}
          busy={busy}
          submitLabel=""
          rows={2}
          className="shadow-sm"
        />
      </div>
    </div>
  )
}
