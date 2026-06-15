import Link from "next/link"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

const STATS = [
  { value: "20+", label: "Field types" },
  { value: "30+", label: "Languages" },
  { value: "95%", label: "Completion" },
  { value: "1 min", label: "Build time" },
]

export function AboutPlatform() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid items-center gap-x-14 gap-y-14 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow>About MakingFlow</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-4 max-w-md font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                An AI-native platform designed to build smarter forms.
              </h2>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
                Startup, agency, or enterprise: describe what you need in plain words and
                MakingFlow drafts the form, adapts it to each respondent, and summarizes every
                answer. Less busywork, better data.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-7">
                <Link
                  href="/auth/signup"
                  className="inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-8 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto sm:min-w-56"
                >
                  Start for free
                </Link>
              </div>
            </Reveal>
          </div>

          {/* Visual: a clean product card on an aurora glow + a tidy stats strip. */}
          <Reveal delay={160}>
            <div className="relative mx-auto w-full max-w-md">
              {/* aurora glow */}
              <div
                aria-hidden
                className="absolute -inset-x-6 -top-10 -z-10 h-64 bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)] blur-2xl"
              />
              <div
                aria-hidden
                className="absolute -bottom-10 right-0 -z-10 h-40 w-40 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--secondary)_42%,transparent),transparent)] blur-2xl"
              />

              {/* product card */}
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                  <span className="text-sm font-semibold text-foreground">Customer feedback</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    Live
                  </span>
                </div>

                <div className="space-y-4 p-5">
                  <div>
                    <p className="text-xs font-medium text-foreground">How happy are you at work?</p>
                    <div className="mt-2 flex gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={
                            "grid size-8 place-items-center rounded-md border text-xs " +
                            (n === 4
                              ? "border-foreground bg-foreground text-background"
                              : "border-input text-muted-foreground")
                          }
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">What could we improve?</p>
                    <div className="mt-2 h-12 rounded-md border border-input" />
                  </div>
                  <div className="flex gap-2">
                    <span className="rounded-md border border-foreground bg-foreground px-4 py-1.5 text-xs text-background">
                      Yes
                    </span>
                    <span className="rounded-md border border-input px-4 py-1.5 text-xs text-muted-foreground">
                      No
                    </span>
                  </div>
                </div>
              </div>

              {/* tidy stats strip */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STATS.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-lg border border-border bg-background px-3 py-2.5 text-center"
                  >
                    <p className="font-sebenta text-lg font-bold tracking-tight text-primary">
                      {s.value}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
