import { Reveal } from "./reveal"

export function FillModes() {
  return (
    <section className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-2xl font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            One form. Two ways to fill it.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-muted-foreground">
            Flip between them with a single toggle. The data you collect is the
            same either way, so you never trade clean answers for a nicer
            experience.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Reveal delay={120}>
            <ModeCard
              label="Classic"
              title="A calm, multi step form."
              body="Every question on the page, paced with progress. Fast to skim, friendly on mobile, and it works perfectly even with the AI turned off."
            >
              <div className="space-y-3.5 rounded-lg border border-border bg-background p-4">
                <div className="h-1 w-24 rounded-full bg-foreground/80" />
                <Line label="Full name" />
                <Line label="What brings you here today?" tall />
                <div className="flex gap-2 pt-1">
                  <span className="rounded-md border border-input px-3 py-1 text-xs text-foreground">First time</span>
                  <span className="rounded-md border border-foreground bg-foreground px-3 py-1 text-xs text-background">Returning</span>
                </div>
              </div>
            </ModeCard>
          </Reveal>

          <Reveal delay={200}>
            <ModeCard
              label="Conversational"
              title="One question at a time, like a chat that listens."
              body="The AI asks, clarifies, and moves at the respondent's pace. Best for longer or more personal forms, where a wall of fields would scare people off."
            >
              <div className="space-y-2.5 rounded-lg border border-border bg-background p-4">
                <ChatLine side="ai">What brings you here today?</ChatLine>
                <ChatLine side="user">Thinking about switching from our old tool.</ChatLine>
                <ChatLine side="ai">Makes sense. What is missing in the one you have now?</ChatLine>
              </div>
            </ModeCard>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function ModeCard({
  label,
  title,
  body,
  children,
}: {
  label: string
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-background p-6 sm:p-7">
      <span className="inline-flex w-fit items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <h3 className="mt-3 font-sebenta text-xl font-bold tracking-tight text-foreground">{title}</h3>
      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-6">{children}</div>
    </div>
  )
}

function Line({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className={(tall ? "h-12 " : "h-8 ") + "rounded-md border border-input"} />
    </div>
  )
}

function ChatLine({ side, children }: { side: "ai" | "user"; children: React.ReactNode }) {
  return (
    <div className={side === "user" ? "flex justify-end" : "flex justify-start"}>
      <span
        className={
          "max-w-[88%] rounded-2xl px-3 py-1.5 text-sm " +
          (side === "user"
            ? "rounded-br-md bg-foreground text-background"
            : "rounded-bl-md bg-muted text-foreground")
        }
      >
        {children}
      </span>
    </div>
  )
}
