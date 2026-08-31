import Link from "next/link"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

const STEPS = [
  {
    n: "Step 1",
    title: "Describe your form",
    body: "Write what you need in a sentence. The form assembles as you type, ready to edit by hand.",
  },
  {
    n: "Step 2",
    title: "It adapts as people answer",
    body: "Natural follow-ups, plain-English logic, and every respondent answering in their own language.",
  },
  {
    n: "Step 3",
    title: "Read clean answers",
    body: "Each response lands organized with a short summary, ready in your inbox, a sheet, or your own tools.",
  },
]

export function ThreeSteps() {
  return (
    <section id="how" className="scroll-mt-20 bg-background px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl rounded-xl bg-[linear-gradient(180deg,var(--accent),color-mix(in_oklab,var(--primary)_5%,var(--background)))] px-6 py-16 sm:px-12 sm:py-20">
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2 lg:items-center">
          <div>
            <Reveal>
              <Eyebrow>How MakingFlow works</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-4 max-w-sm text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                Build in 3 steps.
              </h2>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-muted-foreground">
                MakingFlow makes building forms effortless. You describe what you need in plain
                words, it drafts the whole thing, and it keeps working while people fill it out,
                asking natural follow-ups, translating on the fly, and summarizing every answer.
                From a single sentence to a live, intelligent form, here is how it works.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-7">
                <Link
                  href="/auth/signup"
                  className="inline-flex h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  Start for free
                </Link>
              </div>
            </Reveal>
          </div>

          <div className="space-y-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <div className="rounded-lg border border-border bg-background/80 p-5 backdrop-blur">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    {s.n}
                  </span>
                  <h3 className="mt-2.5 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
