import { Reveal } from "./reveal"

const SUGGESTIONS = [
  "Summarize this week",
  "What are the top complaints?",
  "Which candidates to shortlist?",
]

export function AskAiSection() {
  return (
    <section className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <div className="grid gap-x-14 lg:gap-x-[3.889vw] gap-y-10 lg:gap-y-[2.778vw] lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div>
            <Reveal>
              <p className="text-sm lg:text-[0.972vw] font-medium text-primary">AI summaries</p>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-4 lg:mt-[1.111vw] max-w-md lg:max-w-[31.111vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                Ask your responses a question. Get a real answer.
              </h2>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-4 lg:mt-[1.111vw] max-w-[52ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
                Every response comes with a short summary at the top. And when you
                want the bigger picture, just ask. It reads all of them and tells
                you what is actually going on, with the numbers to back it up.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-6 lg:mt-[1.667vw] flex flex-wrap gap-2 lg:gap-[0.556vw]">
                {SUGGESTIONS.map((s) => (
                  <span
                    key={s}
                    className="rounded-md lg:rounded-[0.556vw] border border-border bg-background px-3 lg:px-[0.833vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-muted-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal delay={160}>
            <div className="overflow-hidden rounded-xl lg:rounded-[0.926vw] border border-border bg-background shadow-lg">
              <div className="flex items-center gap-2.5 lg:gap-[0.694vw] border-b border-border px-4 lg:px-[1.111vw] py-3 lg:py-[0.833vw]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo/logo.svg" alt="" className="size-5 lg:size-[1.389vw] rounded lg:rounded-[0.324vw]" />
                <span className="text-sm lg:text-[0.972vw] font-medium text-foreground">Ask AI</span>
              </div>

              <div className="space-y-4 lg:space-y-[1.111vw] p-4 lg:p-[1.111vw] sm:p-5">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl lg:rounded-[1.111vw] rounded-br-md lg:rounded-br-[0.556vw] bg-foreground px-3.5 lg:px-[0.972vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-background">
                    What are candidates most excited about, and what worries them?
                  </p>
                </div>

                <div className="flex items-start gap-2.5 lg:gap-[0.694vw]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo/logo.svg" alt="" className="mt-0.5 lg:mt-[0.139vw] size-6 lg:size-[1.667vw] shrink-0 rounded-md lg:rounded-[0.556vw]" />
                  <div className="max-w-[92%] space-y-2.5 lg:space-y-[0.694vw] text-sm lg:text-[0.972vw] leading-relaxed text-foreground">
                    <p>Across 312 responses, two things stand out.</p>
                    <ul className="space-y-2 lg:space-y-[0.556vw]">
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

              <div className="border-t border-border p-3 lg:p-[0.833vw]">
                <div className="flex items-center gap-2 lg:gap-[0.556vw] rounded-xl lg:rounded-[0.926vw] border border-border bg-background p-2.5 lg:p-[0.694vw]">
                  <span className="flex-1 px-1 lg:px-[0.278vw] text-sm lg:text-[0.972vw] text-muted-foreground">
                    Ask about your responses...
                  </span>
                  <span className="grid size-8 lg:size-[2.222vw] place-items-center rounded-lg lg:rounded-[0.694vw] bg-foreground text-background">
                    <svg viewBox="0 0 24 24" className="size-4 lg:size-[1.111vw]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
