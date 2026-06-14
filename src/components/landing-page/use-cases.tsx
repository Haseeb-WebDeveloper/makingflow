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
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-2xl lg:max-w-[46.667vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            A form is a form. So this works for most of yours.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mt-4 lg:mt-[1.111vw] max-w-[60ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
            Job application or customer survey, lead form or creative brief, it is
            the same handful of building blocks underneath. Here is where teams
            reach for it first.
          </p>
        </Reveal>

        <div className="mt-12 lg:mt-[3.333vw] grid gap-5 lg:gap-[1.389vw] sm:grid-cols-2">
          {USES.map((u, i) => (
            <Reveal key={u.title} delay={(i % 2) * 80}>
              <div className="flex h-full flex-col rounded-xl lg:rounded-[0.926vw] border border-border bg-background p-6 lg:p-[1.667vw]">
                <h3 className="text-lg lg:text-[1.25vw] font-semibold text-foreground">{u.title}</h3>
                <p className="mt-2 lg:mt-[0.556vw] max-w-[52ch] flex-1 text-sm lg:text-[0.972vw] leading-relaxed text-muted-foreground">
                  {u.body}
                </p>
                <div className="mt-5 lg:mt-[1.389vw] flex flex-wrap gap-1.5 lg:gap-[0.417vw]">
                  {u.examples.map((e) => (
                    <span
                      key={e}
                      className="rounded-md lg:rounded-[0.556vw] border border-border px-2.5 lg:px-[0.694vw] py-1 lg:py-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground"
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
