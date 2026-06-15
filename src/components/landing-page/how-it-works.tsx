import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

type IconName = "describe" | "adapt" | "read"

const STEPS: {
  n: string
  title: string
  body: string
  icon: IconName
  chip: string
  num: string
}[] = [
  {
    n: "01",
    title: "Describe it in a sentence.",
    body: "Write what you need the way you'd say it out loud — “a job application for a motion designer, ask for a showreel.” The form assembles as you type, and you can edit any block by hand.",
    icon: "describe",
    chip: "bg-primary/10 text-primary",
    num: "text-primary/20",
  },
  {
    n: "02",
    title: "It adapts as people answer.",
    body: "When a reply is thin, it asks a natural follow-up. When a question doesn't apply, it quietly skips it. Everyone fills it out in their own language; answers come back in yours.",
    icon: "adapt",
    chip: "bg-chart-3/10 text-chart-3",
    num: "text-chart-3/20",
  },
  {
    n: "03",
    title: "You read clean answers.",
    body: "Each response lands organized, with a short summary on top. Skim the inbox, export to a sheet, or send them straight to the tools your team already uses.",
    icon: "read",
    chip: "bg-chart-4/15 text-chart-4",
    num: "text-chart-4/25",
  },
]

export function HowItWorks() {
  return (
    <section
      id="how"
      className="scroll-mt-20 border-t border-border bg-[linear-gradient(180deg,var(--accent),var(--background))]"
    >
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 max-w-2xl font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            From a sentence to a working form, in about a minute.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="flex h-full flex-col rounded-xl border border-border bg-background p-6 shadow-sm transition-shadow hover:shadow-md sm:p-7">
                <div className="flex items-center justify-between">
                  <span className={`grid size-11 place-items-center rounded-xl ${s.chip}`}>
                    <StepIcon name={s.icon} />
                  </span>
                  <span className={`font-sebenta text-3xl font-bold ${s.num}`}>{s.n}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function StepIcon({ name }: { name: IconName }) {
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
  if (name === "describe")
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    )
  if (name === "adapt")
    return (
      <svg {...common}>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    )
  return (
    <svg {...common}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8.5 10.5 11 13l4.5-4.5" />
    </svg>
  )
}
