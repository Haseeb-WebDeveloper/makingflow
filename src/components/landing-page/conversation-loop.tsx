"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

const SCRIPT = [
  { side: "ai", text: "What brings you to MakingFlow today?" },
  { side: "user", text: "Switching from our old form tool." },
  { side: "ai", text: "Makes sense — what was missing for you?" },
  { side: "user", text: "It never understood the answers." },
] as const

// One looping timeline: count = bubbles shown, typing = show the dots, ms = hold.
const STEPS: { count: number; typing: boolean; ms: number }[] = [
  { count: 0, typing: true, ms: 1000 },
  { count: 1, typing: false, ms: 1100 },
  { count: 2, typing: false, ms: 1100 },
  { count: 2, typing: true, ms: 1000 },
  { count: 3, typing: false, ms: 1100 },
  { count: 4, typing: false, ms: 2200 },
  { count: 0, typing: false, ms: 700 },
]

/** The "form that listens" mock — replays a short adaptive conversation on a
 *  loop. Falls back to the full, static conversation when reduced motion is on. */
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

export function ConversationLoop() {
  const [i, setI] = useState(0)
  const reduce = usePrefersReducedMotion()

  useEffect(() => {
    if (reduce) return
    const t = setTimeout(() => setI((p) => (p + 1) % STEPS.length), STEPS[i].ms)
    return () => clearTimeout(t)
  }, [i, reduce])

  const { count, typing } = reduce ? { count: SCRIPT.length, typing: false } : STEPS[i]
  const visible = SCRIPT.slice(0, count)
  const enter = reduce ? "" : "animate-in fade-in slide-in-from-bottom-1 duration-300 "

  return (
    <div className="flex h-full min-h-72 flex-col gap-4 rounded-xl border border-border bg-[linear-gradient(160deg,color-mix(in_oklab,var(--primary)_7%,var(--background)),color-mix(in_oklab,var(--secondary)_12%,var(--background)))] p-5 sm:p-6">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
              <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2L12 2z" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-foreground">Onboarding form</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
          <span className="relative flex size-1.5">
            {!reduce ? (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            ) : null}
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          Live
        </span>
      </div>

      {/* conversation — fills the panel, anchored to the bottom */}
      <div className="flex flex-1 flex-col justify-end gap-2.5">
        {visible.map((m, idx) => (
          <div
            key={idx}
            className={enter + "flex " + (m.side === "user" ? "justify-end" : "justify-start")}
          >
            <span
              className={
                "max-w-[85%] px-3 py-1.5 text-xs leading-relaxed " +
                (m.side === "user"
                  ? "rounded-lg rounded-br-sm bg-foreground text-background"
                  : "rounded-lg rounded-bl-sm border border-border bg-background text-foreground")
              }
            >
              {m.text}
            </span>
          </div>
        ))}
        {typing ? (
          <div className={enter + "flex items-center gap-1.5 pl-1 pt-0.5"}>
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </div>
        ) : null}
      </div>

      {/* input */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <span className="flex-1 text-xs text-muted-foreground">Type your answer…</span>
        <span className="grid size-7 place-items-center rounded-md bg-foreground text-background">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </span>
      </div>
    </div>
  )
}
