import { Reveal } from "./reveal"

export function FillModes() {
  return (
    <section className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-2xl lg:max-w-[46.667vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            One form. Two ways to fill it.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mt-4 lg:mt-[1.111vw] max-w-[60ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
            Flip between them with a single toggle. The data you collect is the
            same either way, so you never trade clean answers for a nicer
            experience.
          </p>
        </Reveal>

        <div className="mt-12 lg:mt-[3.333vw] grid gap-5 lg:gap-[1.389vw] lg:grid-cols-2">
          <Reveal delay={120}>
            <ModeCard
              label="Classic"
              title="A calm, multi step form."
              body="Every question on the page, paced with progress. Fast to skim, friendly on mobile, and it works perfectly even with the AI turned off."
            >
              <div className="space-y-3.5 lg:space-y-[0.972vw] rounded-lg lg:rounded-[0.694vw] border border-border bg-background p-4 lg:p-[1.111vw]">
                <div className="h-1 lg:h-[0.278vw] w-24 lg:w-[6.667vw] rounded-full bg-foreground/80" />
                <Line label="Full name" />
                <Line label="What brings you here today?" tall />
                <div className="flex gap-2 lg:gap-[0.556vw] pt-1 lg:pt-[0.278vw]">
                  <span className="rounded-md lg:rounded-[0.556vw] border border-input px-3 lg:px-[0.833vw] py-1 lg:py-[0.278vw] text-xs lg:text-[0.833vw] text-foreground">First time</span>
                  <span className="rounded-md lg:rounded-[0.556vw] border border-foreground bg-foreground px-3 lg:px-[0.833vw] py-1 lg:py-[0.278vw] text-xs lg:text-[0.833vw] text-background">Returning</span>
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
              <div className="space-y-2.5 lg:space-y-[0.694vw] rounded-lg lg:rounded-[0.694vw] border border-border bg-background p-4 lg:p-[1.111vw]">
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
    <div className="flex h-full flex-col rounded-xl lg:rounded-[0.926vw] border border-border bg-background p-6 lg:p-[1.667vw] sm:p-7">
      <span className="inline-flex w-fit items-center rounded-full border border-border px-2.5 lg:px-[0.694vw] py-0.5 lg:py-[0.139vw] text-xs lg:text-[0.833vw] font-medium text-muted-foreground">
        {label}
      </span>
      <h3 className="mt-3 lg:mt-[0.833vw] font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground">{title}</h3>
      <p className="mt-2 lg:mt-[0.556vw] max-w-[52ch] text-sm lg:text-[0.972vw] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-6 lg:mt-[1.667vw]">{children}</div>
    </div>
  )
}

function Line({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div className="space-y-1.5 lg:space-y-[0.417vw]">
      <p className="text-xs lg:text-[0.833vw] font-medium text-foreground">{label}</p>
      <div className={(tall ? "h-12 lg:h-[3.333vw] " : "h-8 ") + "rounded-md lg:rounded-[0.556vw] border border-input"} />
    </div>
  )
}

function ChatLine({ side, children }: { side: "ai" | "user"; children: React.ReactNode }) {
  return (
    <div className={side === "user" ? "flex justify-end" : "flex justify-start"}>
      <span
        className={
          "max-w-[88%] rounded-2xl lg:rounded-[1.111vw] px-3 lg:px-[0.833vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] " +
          (side === "user"
            ? "rounded-br-md lg:rounded-br-[0.556vw] bg-foreground text-background"
            : "rounded-bl-md lg:rounded-bl-[0.556vw] bg-muted text-foreground")
        }
      >
        {children}
      </span>
    </div>
  )
}
