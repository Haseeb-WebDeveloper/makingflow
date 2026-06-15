"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

type Pills = "rating" | "yesno" | null

const TURNS: { role: "ai" | "user"; text: string; pills?: Pills }[] = [
  { role: "ai", text: "How happy are you at work right now?", pills: "rating" },
  { role: "user", text: "4" },
  { role: "ai", text: "Thanks! What is one thing we could improve?" },
  { role: "user", text: "Faster onboarding for new hires." },
  { role: "ai", text: "Would you recommend us as a place to work?", pills: "yesno" },
  { role: "user", text: "Yes" },
]

// One looping timeline. `shown` = turns revealed, `thinking` = the assistant is
// composing the next message (renders a "Thinking…" bubble), `ms` = hold.
const STEPS: { shown: number; thinking: boolean; ms: number }[] = [
  { shown: 0, thinking: true, ms: 1000 },
  { shown: 1, thinking: false, ms: 1600 },
  { shown: 2, thinking: false, ms: 1100 },
  { shown: 2, thinking: true, ms: 1000 },
  { shown: 3, thinking: false, ms: 1700 },
  { shown: 4, thinking: false, ms: 1200 },
  { shown: 4, thinking: true, ms: 1000 },
  { shown: 5, thinking: false, ms: 1500 },
  { shown: 6, thinking: false, ms: 1800 },
  { shown: 0, thinking: false, ms: 700 },
]

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  )
}

/**
 * A faithful mock of a published MakingFlow form in conversational mode — banner,
 * logo, title, the real chat UI, and the composer. The card height is fixed; the
 * conversation auto-scrolls to the bottom as new turns arrive (the header scrolls
 * up, the composer stays pinned) — exactly like the live form. Loops, and shows
 * the full exchange static under reduced motion.
 */
export function ConversationLoop() {
  const [i, setI] = useState(0)
  const reduce = usePrefersReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reduce) return
    const t = setTimeout(() => setI((p) => (p + 1) % STEPS.length), STEPS[i].ms)
    return () => clearTimeout(t)
  }, [i, reduce])

  // Pin the conversation to the bottom whenever a turn is added (like the real
  // form scrolling the page down on each new message).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" })
  }, [i, reduce])

  const { shown, thinking } = reduce ? { shown: TURNS.length, thinking: false } : STEPS[i]
  const visible = TURNS.slice(0, shown)
  const last = visible[visible.length - 1]
  const showPills = !thinking && last?.role === "ai" ? (last.pills ?? null) : null
  const enter = reduce ? "" : "animate-in fade-in slide-in-from-bottom-1 duration-300 "

  return (
    <div className="flex h-full min-h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-canvas">
      {/* browser chrome */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <span className="size-2 rounded-full bg-border" />
        <span className="size-2 rounded-full bg-border" />
        <span className="size-2 rounded-full bg-border" />
        <span className="ml-2 truncate rounded bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
          forms.makingflow.com/feedback
        </span>
      </div>

      {/* scrolling form body: banner + logo + title + conversation */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] sm:p-5 [&::-webkit-scrollbar]:hidden"
      >
        {/* banner + logo + title (FormBranding mirror) */}
        <div className="h-14 w-full rounded-lg bg-[linear-gradient(110deg,var(--primary),color-mix(in_oklab,var(--secondary)_80%,var(--primary)))]" />
        <div className="mt-3 flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/logo.svg" alt="" className="size-5" />
          </span>
          <span className="font-sebenta text-base font-bold tracking-tight text-foreground">
            Customer feedback
          </span>
        </div>

        {/* conversation */}
        <div className="mt-4 space-y-2.5">
          {visible.map((m, idx) =>
            m.role === "user" ? (
              <div key={idx} className={enter + "flex justify-end"}>
                <span className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                  {m.text}
                </span>
              </div>
            ) : (
              <div key={idx} className={enter + "flex justify-start"}>
                <span className="max-w-[90%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-foreground">
                  {m.text}
                </span>
              </div>
            ),
          )}

          {thinking ? (
            <div className={enter + "flex justify-start"}>
              <span className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                Thinking…
              </span>
            </div>
          ) : null}

          {showPills === "rating" ? (
            <div className={enter + "flex flex-wrap gap-1.5 pt-0.5"}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className="inline-flex size-9 items-center justify-center rounded-md border border-input text-sm text-foreground"
                >
                  {n}
                </span>
              ))}
            </div>
          ) : null}
          {showPills === "yesno" ? (
            <div className={enter + "flex flex-wrap gap-2 pt-0.5"}>
              {["Yes", "No"].map((o) => (
                <span
                  key={o}
                  className="rounded-md border border-input px-3.5 py-1.5 text-sm text-foreground"
                >
                  {o}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* composer (pinned, mirror) */}
      <div className="shrink-0 border-t border-border bg-canvas p-3 sm:p-4">
        <div className="rounded-2xl border border-border bg-background p-2.5">
          <p className="px-1 pt-0.5 text-sm text-muted-foreground">Type your answer…</p>
          <div className="flex justify-end pt-1">
            <span className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
