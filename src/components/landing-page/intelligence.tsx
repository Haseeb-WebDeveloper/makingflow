import { Reveal } from "./reveal"

export function Intelligence() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-sm font-medium text-primary">What “thinking” actually means</p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 max-w-2xl font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            The intelligence shows up while the form is being filled out.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          <Reveal delay={120}>
            <Capability
              title="It asks the obvious follow up"
              body="When someone leaves a thin answer, it asks the question you would have asked. You get the reason, not just the rating."
            >
              <div className="space-y-2">
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
              <div className="space-y-2.5">
                <p className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground">
                  If they are a returning customer, skip the intro.
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Arrow />
                  <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">
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
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {["Bonjour", "Hola", "こんにちは", "Olá"].map((w) => (
                  <span key={w} className="rounded-md border border-input px-2.5 py-1 text-foreground">
                    {w}
                  </span>
                ))}
                <Arrow />
                <span className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-foreground">
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
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Summary
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground">
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
    <div className="flex h-full flex-col rounded-xl border border-border p-5 sm:p-6">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-[46ch] text-sm leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function Bubble({ side, children }: { side: "user" | "ai"; children: React.ReactNode }) {
  if (side === "user") {
    return (
      <div className="flex justify-end">
        <span className="max-w-[80%] rounded-2xl rounded-br-md bg-foreground px-3 py-1.5 text-sm text-background">
          {children}
        </span>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <span className="max-w-[88%] rounded-2xl rounded-bl-md bg-muted px-3 py-1.5 text-sm text-foreground">
        {children}
      </span>
    </div>
  )
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
