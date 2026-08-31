import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

export function WhySection() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <Reveal>
              <Eyebrow>Why we built this</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-4 max-w-xl text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                Most forms collect answers. They never understand them.
              </h2>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-5 max-w-[58ch] text-base leading-relaxed text-muted-foreground">
                For years you had to pick a side. A form that looks calm but treats
                a thoughtful reply and a one-word shrug exactly the same, or a
                clever tool buried in so many settings that one question turns into
                an afternoon.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-4 max-w-[58ch] text-base leading-relaxed text-muted-foreground">
                MakingFlow keeps the quiet, document-style editing you enjoy, and
                adds the part that was always missing: a form that pays attention
                while someone fills it out, and hands back answers ready to read.
              </p>
            </Reveal>
          </div>

          <Reveal delay={160}>
            <div className="rounded-xl border border-border bg-background p-5 shadow-sm sm:p-6">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                A real answer
              </span>
              <div className="mt-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm text-foreground">
                “It was fine, I guess.”
              </div>

              <div className="my-3 flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                <Arrow />
                MakingFlow asks the obvious follow-up
              </div>
              <div className="rounded-xl border border-primary/15 bg-primary/[0.04] px-3.5 py-2.5 text-sm text-foreground">
                “What would have made it a great experience?”
              </div>

              <div className="mt-4 rounded-xl border border-border bg-[color-mix(in_oklab,var(--accent)_55%,var(--background))] p-3.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-accent-foreground/70">
                  What you read
                </span>
                <p className="mt-1 text-sm leading-relaxed text-foreground">
                  Wanted faster onboarding and clearer ownership in the first month.
                  Otherwise happy and likely to stay.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}
