"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import {
  Pills,
  CONVERSATION_OPENING_PHRASES,
  CONVERSATION_REPLY_PHRASES,
} from "@/components/forms/conversational-runtime"
import { Thinking } from "@/components/forms/thinking"
import { SVGIcon } from "@/components/ui/svg-icon"
import type { PublicField } from "@/lib/data/public-form"

// Same code-split success animation the runtimes use.
const Lottie = dynamic(() => import("@/components/builder/lottie").then((m) => m.Lottie), {
  ssr: false,
})

/**
 * /sandbox — a dev-only gallery of the conversational form states so we can see
 * thinking text, bubbles, pills, the composer, and the success screen without
 * publishing a real form and clicking through it. Not linked from anywhere.
 */
export default function SandboxPage() {
  const [thinkKey, setThinkKey] = useState(0)
  const [openKey, setOpenKey] = useState(0)
  const [disabled, setDisabled] = useState(false)
  const [text, setText] = useState("")
  const [multi, setMulti] = useState<string[]>([])
  const noop = () => {}

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="font-sebenta text-2xl font-bold tracking-tight text-foreground">
          Conversational states
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visual preview of every conversational form state. Dev only.
        </p>
      </header>

      <div className="space-y-8">
        <Section
          title="Thinking: after a reply"
          desc="Rotates: Reading your answer → Thinking → Lining up the next question."
          action={
            <ReplayButton onClick={() => setThinkKey((k) => k + 1)} />
          }
        >
          <AssistantBubble>
            <Thinking key={thinkKey} phrases={CONVERSATION_REPLY_PHRASES} />
          </AssistantBubble>
        </Section>

        <Section
          title="Thinking: opening turn"
          desc="Rotates: Getting things ready → One moment."
          action={<ReplayButton onClick={() => setOpenKey((k) => k + 1)} />}
        >
          <AssistantBubble>
            <Thinking key={`o${openKey}`} phrases={CONVERSATION_OPENING_PHRASES} />
          </AssistantBubble>
        </Section>

        <Section title="Chat bubbles" desc="Assistant message and the respondent reply.">
          <div className="space-y-4">
            <AssistantBubble>
              Got it. And roughly how many people are on your team right now?
            </AssistantBubble>
            <div className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                We are about twelve, growing to twenty by the end of the year.
              </div>
            </div>
          </div>
        </Section>

        <Section title="Option pills" desc="Tappable answers under the question (still typeable).">
          <div className="space-y-5">
            <Pills field={F.yesNo} multi={multi} setMulti={setMulti} onSend={noop} />
            <Pills field={F.choice} multi={multi} setMulti={setMulti} onSend={noop} />
            <Pills field={F.rating} multi={multi} setMulti={setMulti} onSend={noop} />
            <Pills field={F.multi} multi={multi} setMulti={setMulti} onSend={noop} />
          </div>
        </Section>

        <Section
          title="Composer"
          desc="The fixed answer box. Disabled while the AI responds."
          action={
            <button
              type="button"
              onClick={() => setDisabled((d) => !d)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              {disabled ? "Enable" : "Disable"}
            </button>
          }
        >
          <div className="rounded-2xl border border-border bg-background p-2.5 shadow-sm transition-colors focus-within:border-foreground/30">
            <textarea
              rows={1}
              value={text}
              disabled={disabled}
              placeholder="Type your answer…"
              onChange={(e) => setText(e.target.value)}
              className="thin-scroll block w-full resize-none border-0 bg-transparent px-2 pt-1 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="flex items-center justify-end pl-1 pr-0.5 pt-1">
              <button
                type="button"
                disabled={disabled || !text.trim()}
                aria-label="Send"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <SVGIcon src="/icons/arrow-up.svg" className="size-5" />
              </button>
            </div>
          </div>
        </Section>

        <Section title="Submitting" desc="Shown between the last answer and the success screen.">
          <p className="text-center text-xs text-muted-foreground">Recording your response…</p>
        </Section>

        <Section title="Success screen" desc="Now matches the classic form's animated check.">
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background py-10 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
              <Lottie name="success" className="size-52" />
            </div>
            <h2 className="mt-4 font-sebenta text-2xl font-bold tracking-tight text-foreground">
              Thanks! Your response has been recorded.
            </h2>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── Preview scaffolding ──────────────────────────────────────────────────────

function Section({
  title,
  desc,
  action,
  children,
}: {
  title: string
  desc?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-canvas p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {desc ? <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-foreground">
        {children}
      </div>
    </div>
  )
}

function ReplayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
    >
      Replay
    </button>
  )
}

// Minimal mock fields for the pill previews.
const mock = (over: Partial<PublicField>): PublicField => ({
  id: over.id ?? "f",
  type: "short_text",
  label: "Field",
  required: false,
  ...over,
})
const opts = (labels: string[]) => labels.map((label, i) => ({ id: `o${i}`, label }))
const F = {
  yesNo: mock({ id: "yn", type: "yes_no", label: "Would you recommend us?" }),
  choice: mock({
    id: "ch",
    type: "multiple_choice",
    label: "Plan",
    options: opts(["Starter", "Growth", "Enterprise"]),
  }),
  rating: mock({ id: "rt", type: "rating", label: "How happy are you?" }),
  multi: mock({
    id: "ms",
    type: "multi_select",
    label: "Which channels?",
    options: opts(["Email", "Search", "Social", "Referral"]),
  }),
}
