import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

const SUGGESTIONS = [
  "Summarize this week",
  "What are the top complaints?",
  "Which candidates to shortlist?",
]

export function AskAiSection() {
  return (
    <section className="border-t border-border bg-[linear-gradient(180deg,var(--accent),var(--background))]">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div>
            <Reveal>
              <Eyebrow>AI summaries</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-4 max-w-md font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                Ask your responses a question. Get a real answer.
              </h2>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
                Every response comes with a short summary at the top. And when you
                want the bigger picture, just ask. It reads all of them and tells
                you what is actually going on, with the numbers to back it up.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-6 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <span
                    key={s}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal delay={160}>
            <div className="overflow-hidden rounded-xl border border-border bg-background shadow-lg">
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo/logo.svg" alt="" className="size-5 rounded" />
                <span className="text-sm font-medium text-foreground">Ask AI</span>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                    What are candidates most excited about, and what worries them?
                  </p>
                </div>

                <div className="flex items-start gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo/logo.svg" alt="" className="mt-0.5 size-6 shrink-0 rounded-md" />
                  <div className="max-w-[92%] space-y-2.5 text-sm leading-relaxed text-foreground">
                    <p>Across 312 responses, two things stand out.</p>
                    <ul className="space-y-2">
                      <li>
                        <span className="font-semibold">Most excited about</span> design
                        ownership and the new brand system. Mentioned in 64% of answers.
                      </li>
                      <li>
                        <span className="font-semibold">Biggest worry</span> is unclear
                        expectations in the first ninety days. Came up in 28%.
                      </li>
                      <li>
                        <span className="font-semibold">Worth a look</span>, four strong
                        candidates flagged the salary range as a dealbreaker.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="border-t border-border p-3">
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-2.5">
                  <span className="flex-1 px-1 text-sm text-muted-foreground">
                    Ask about your responses...
                  </span>
                  <span className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
