import { Reveal } from "./reveal"

const USES = [
  {
    title: "Hiring and recruiting",
    body: "Take applications, screen them against what you actually care about, and read a per candidate summary instead of fifty raw answers.",
    examples: ["Job application", "Freelancer intake", "Portfolio submission"],
  },
  {
    title: "Client and project intake",
    body: "Turn a vague brief into a structured one. The form clarifies weak answers before they reach your team.",
    examples: ["Creative brief", "Onboarding questionnaire", "Feedback and approval"],
  },
  {
    title: "Surveys and feedback",
    body: "Get past the rating. Conversational depth captures the why, so a pulse check tells you something you can act on.",
    examples: ["Customer satisfaction", "NPS", "Team pulse check"],
  },
  {
    title: "Lead capture",
    body: "Ask the next question based on the last answer, qualify as you go, and route the good ones straight to your team.",
    examples: ["Demo request", "Contact", "Qualification flow"],
  },
]

export function UseCases() {
  return (
    <section className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-2xl font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            A form is a form. So this works for most of yours.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-muted-foreground">
            Job application or customer survey, lead form or creative brief, it is
            the same handful of building blocks underneath. Here is where teams
            reach for it first.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {USES.map((u, i) => (
            <Reveal key={u.title} delay={(i % 2) * 80}>
              <div className="flex h-full flex-col rounded-xl border border-border bg-background p-6">
                <h3 className="text-lg font-semibold text-foreground">{u.title}</h3>
                <p className="mt-2 max-w-[52ch] flex-1 text-sm leading-relaxed text-muted-foreground">
                  {u.body}
                </p>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {u.examples.map((e) => (
                    <span
                      key={e}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
