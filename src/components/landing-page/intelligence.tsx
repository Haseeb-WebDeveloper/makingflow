import { Reveal } from "./reveal"

export function Intelligence() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-sm lg:text-[0.972vw] font-medium text-primary">What “thinking” actually means</p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 lg:mt-[1.111vw] max-w-2xl lg:max-w-[46.667vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            The intelligence shows up while the form is being filled out.
          </h2>
        </Reveal>

        <div className="mt-12 lg:mt-[3.333vw] grid gap-5 lg:gap-[1.389vw] sm:grid-cols-2">
          <Reveal delay={120}>
            <Capability
              title="It asks the obvious follow up"
              body="When someone leaves a thin answer, it asks the question you would have asked. You get the reason, not just the rating."
            >
              <div className="space-y-2 lg:space-y-[0.556vw]">
                <Bubble side="user">It was fine, I guess.</Bubble>
                <Bubble side="ai">Got it. What would have made it a great experience?</Bubble>
              </div>
            </Capability>
          </Reveal>

          <Reveal delay={200}>
            <Capability
              title="Write logic the way you talk"
              body="Type a rule in plain language and it becomes real branching. No condition trees to wire up by hand."
            >
              <div className="space-y-2.5 lg:space-y-[0.694vw]">
                <p className="rounded-lg lg:rounded-[0.694vw] border border-input bg-background px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-foreground">
                  If they are a returning customer, skip the intro.
                </p>
                <div className="flex items-center gap-2 lg:gap-[0.556vw] text-xs lg:text-[0.833vw] text-muted-foreground">
                  <Arrow />
                  <span className="rounded-md lg:rounded-[0.556vw] bg-muted px-2 lg:px-[0.556vw] py-1 lg:py-[0.278vw] font-medium text-foreground">
                    Hide “Welcome” when Customer is Returning
                  </span>
                </div>
              </div>
            </Capability>
          </Reveal>

          <Reveal delay={160}>
            <Capability
              title="Everyone answers in their language"
              body="The form meets each person in the language they typed in, then normalizes every answer back to yours. No translation tables to keep."
            >
              <div className="flex flex-wrap items-center gap-2 lg:gap-[0.556vw] text-sm lg:text-[0.972vw]">
                {["Bonjour", "Hola", "こんにちは", "Olá"].map((w) => (
                  <span key={w} className="rounded-md lg:rounded-[0.556vw] border border-input px-2.5 lg:px-[0.694vw] py-1 lg:py-[0.278vw] text-foreground">
                    {w}
                  </span>
                ))}
                <Arrow />
                <span className="rounded-md lg:rounded-[0.556vw] bg-accent px-2.5 lg:px-[0.694vw] py-1 lg:py-[0.278vw] font-medium text-accent-foreground">
                  English
                </span>
              </div>
            </Capability>
          </Reveal>

          <Reveal delay={240}>
            <Capability
              title="Answers arrive already read"
              body="Every response opens with a short, honest summary. Skim a hundred in the time it used to take to read ten."
            >
              <div className="rounded-lg lg:rounded-[0.694vw] border border-border bg-muted/40 p-3 lg:p-[0.833vw]">
                <p className="text-[11px] lg:text-[0.764vw] font-medium uppercase tracking-wide text-muted-foreground">
                  Summary
                </p>
                <p className="mt-1.5 lg:mt-[0.417vw] text-sm lg:text-[0.972vw] leading-relaxed text-foreground">
                  Strong on craft and communication. Wants more design ownership.
                  Available in three weeks.
                </p>
              </div>
            </Capability>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Capability({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col rounded-xl lg:rounded-[0.926vw] border border-border p-5 lg:p-[1.389vw] sm:p-6">
      <h3 className="text-base lg:text-[1.111vw] font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 lg:mt-[0.417vw] max-w-[46ch] text-sm lg:text-[0.972vw] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-5 lg:mt-[1.389vw]">{children}</div>
    </div>
  )
}

function Bubble({ side, children }: { side: "user" | "ai"; children: React.ReactNode }) {
  if (side === "user") {
    return (
      <div className="flex justify-end">
        <span className="max-w-[80%] rounded-2xl lg:rounded-[1.111vw] rounded-br-md lg:rounded-br-[0.556vw] bg-foreground px-3 lg:px-[0.833vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-background">
          {children}
        </span>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <span className="max-w-[88%] rounded-2xl lg:rounded-[1.111vw] rounded-bl-md lg:rounded-bl-[0.556vw] bg-muted px-3 lg:px-[0.833vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-foreground">
        {children}
      </span>
    </div>
  )
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 lg:size-[1.111vw] shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
