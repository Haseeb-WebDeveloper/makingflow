import Link from "next/link"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

const STATS = [
  { value: "20+", label: "Field & content types", pos: "-left-8 top-8" },
  { value: "30+", label: "Languages, automatic", pos: "-right-8 top-28" },
  { value: "95%", label: "Avg. completion", pos: "-left-6 bottom-20" },
  { value: "1 min", label: "Idea to live form", pos: "-right-6 -bottom-3" },
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
                Startup, agency, or enterprise — describe what you need in plain words and
                MakingFlow drafts the form, adapts it to each respondent, and summarizes every
                answer. Less busywork, better data.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/auth/signup"
                  className="inline-flex h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  Start for free
                </Link>
                <Link
                  href="#features"
                  className="inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Learn more
                </Link>
              </div>
            </Reveal>
          </div>

          {/* Visual: a live mini-form mock with floating stat chips. */}
          <Reveal delay={160}>
            <div className="relative mx-auto w-full max-w-sm">
              {/* soft brand glow behind the card */}
              <div
                aria-hidden
                className="absolute inset-0 -z-10 scale-95 rounded-[2rem] bg-[radial-gradient(60%_55%_at_50%_45%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent)] blur-2xl"
              />

              {/* central form preview */}
              <div className="rounded-xl border border-border bg-background p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Customer feedback</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    Live
                  </span>
                </div>
                <div className="mt-4 space-y-3.5">
                  <div>
                    <p className="text-xs font-medium text-foreground">How happy are you at work?</p>
                    <div className="mt-1.5 flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={
                            "grid size-7 place-items-center rounded-md border text-xs " +
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
                    <div className="mt-1.5 h-10 rounded-md border border-input" />
                  </div>
                  <div className="flex gap-2">
                    <span className="rounded-md border border-foreground bg-foreground px-3 py-1 text-xs text-background">
                      Yes
                    </span>
                    <span className="rounded-md border border-input px-3 py-1 text-xs text-muted-foreground">
                      No
                    </span>
                  </div>
                </div>
              </div>

              {/* floating stat chips (desktop only, to avoid mobile overflow) */}
              {STATS.map((s) => (
                <div
                  key={s.label}
                  className={`absolute hidden items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 lg:flex ${s.pos}`}
                >
                  <span className="font-sebenta text-base font-bold text-primary">{s.value}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
