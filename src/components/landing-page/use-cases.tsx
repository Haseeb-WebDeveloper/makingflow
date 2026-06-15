import { Reveal } from "./reveal"

type IconName = "hire" | "intake" | "survey" | "lead"

const USES: {
  title: string
  body: string
  examples: string[]
  icon: IconName
  chip: string
}[] = [
  {
    title: "Hiring and recruiting",
    body: "Take applications, screen them against what you actually care about, and read a per-candidate summary instead of fifty raw answers.",
    examples: ["Job application", "Freelancer intake", "Portfolio submission"],
    icon: "hire",
    chip: "bg-primary/10 text-primary",
  },
  {
    title: "Client and project intake",
    body: "Turn a vague brief into a structured one. The form clarifies weak answers before they ever reach your team.",
    examples: ["Creative brief", "Onboarding questionnaire", "Feedback and approval"],
    icon: "intake",
    chip: "bg-chart-3/10 text-chart-3",
  },
  {
    title: "Surveys and feedback",
    body: "Get past the rating. Conversational depth captures the why, so a pulse check tells you something you can act on.",
    examples: ["Customer satisfaction", "NPS", "Team pulse check"],
    icon: "survey",
    chip: "bg-chart-4/15 text-chart-4",
  },
  {
    title: "Lead capture",
    body: "Ask the next question based on the last answer, qualify as you go, and route the good ones straight to your team.",
    examples: ["Demo request", "Contact", "Qualification flow"],
    icon: "lead",
    chip: "bg-success/10 text-success",
  },
]

export function UseCases() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
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
              <div className="flex h-full flex-col rounded-xl border border-border bg-background p-6 shadow-sm transition-shadow hover:shadow-md">
                <span className={`grid size-11 place-items-center rounded-xl ${u.chip}`}>
                  <UseIcon name={u.icon} />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-foreground">{u.title}</h3>
                <p className="mt-2 max-w-[52ch] flex-1 text-sm leading-relaxed text-muted-foreground">
                  {u.body}
                </p>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {u.examples.map((e) => (
                    <span
                      key={e}
                      className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
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

function UseIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "size-5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }
  if (name === "hire")
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 8h4M19 6v4" />
      </svg>
    )
  if (name === "intake")
    return (
      <svg {...common}>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v4h4M9 13h6M9 17h6" />
      </svg>
    )
  if (name === "survey")
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  )
}
