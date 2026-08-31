import Link from "next/link"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

type Key = "builder" | "analytics" | "logic" | "integrations" | "domain" | "submissions"

const FEATURES: { key: Key; title: string; body: string }[] = [
  {
    key: "builder",
    title: "AI-powered builder",
    body: "Describe a form in plain language and watch it assemble, then refine it just by asking.",
  },
  {
    key: "analytics",
    title: "Real-time analytics",
    body: "Views, completion, and the exact question where people drop off. No dashboards to wire up.",
  },
  {
    key: "logic",
    title: "Plain-English logic",
    body: "Type a branching rule the way you would say it. It compiles into real show/hide conditions.",
  },
  {
    key: "integrations",
    title: "Focused integrations",
    body: "Google Sheets, webhooks, and email: the three places your answers actually need to be.",
  },
  {
    key: "domain",
    title: "Custom domains",
    body: "Serve forms from your own subdomain so every link looks like it belongs to your brand.",
  },
  {
    key: "submissions",
    title: "Smart submissions",
    body: "Filter, search, tag, and export, with an AI summary waiting at the top of every response.",
  },
]

export function FeaturesGrid() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Features</Eyebrow>
          <h2 className="mt-4 text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            Features that set us apart.
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
            MakingFlow goes beyond basic forms with AI that adapts, analytics that explain, and a
            calm builder that makes the whole thing feel effortless.
          </p>
        </Reveal>

        <Reveal delay={80} className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/auth/signup"
            className="inline-flex h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            Start for free
          </Link>
          <Link
            href="#pricing"
            className="inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Explore all features
          </Link>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.key} delay={(i % 3) * 80}>
              <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-foreground/20">
                <div className="grid h-40 place-items-center bg-[linear-gradient(180deg,var(--muted),var(--background))] px-5">
                  <Visual feature={f.key} />
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-base font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {f.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const bar = "rounded bg-foreground/15"

function Visual({ feature }: { feature: Key }) {
  if (feature === "builder")
    return (
      <div className="w-full max-w-[15rem] space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
          <svg viewBox="0 0 24 24" className="size-3.5 text-primary" fill="currentColor" aria-hidden>
            <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2L12 2z" />
          </svg>
          <span className="text-xs text-muted-foreground">a job application form…</span>
        </div>
        <div className="rounded-lg border border-border bg-background p-2.5">
          <div className={`h-1.5 w-16 ${bar}`} />
          <div className="mt-2 h-7 rounded-md border border-input" />
        </div>
      </div>
    )

  if (feature === "analytics")
    return (
      <div className="w-full max-w-[15rem] rounded-lg border border-border bg-background p-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">312</p>
            <p className="text-[11px] text-muted-foreground">Submissions</p>
          </div>
          <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
            +9%
          </span>
        </div>
        <svg viewBox="0 0 200 40" className="mt-2 h-10 w-full" preserveAspectRatio="none" aria-hidden>
          <path
            d="M0 32 L25 28 L50 30 L75 20 L100 24 L125 12 L150 16 L175 8 L200 4"
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    )

  if (feature === "logic")
    return (
      <div className="w-full max-w-[15rem] space-y-2">
        <div className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground">
          If returning customer, skip the intro
        </div>
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="size-3.5 text-primary" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-foreground">
            Hide “Welcome”
          </span>
        </div>
      </div>
    )

  if (feature === "integrations")
    return (
      <div className="flex items-center gap-2.5">
        {[
          { label: "Sheets", chip: "bg-success/10 text-success" },
          { label: "Webhook", chip: "bg-chart-4/15 text-chart-4" },
          { label: "Email", chip: "bg-chart-3/10 text-chart-3" },
        ].map((t) => (
          <div key={t.label} className="flex flex-col items-center gap-1.5">
            <span className={`grid size-11 place-items-center rounded-lg ${t.chip}`}>
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 4v16M4 10h16" />
              </svg>
            </span>
            <span className="text-[10px] text-muted-foreground">{t.label}</span>
          </div>
        ))}
      </div>
    )

  if (feature === "domain")
    return (
      <div className="w-full max-w-[15rem] overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
        </div>
        <div className="flex items-center gap-2 px-2.5 py-2.5">
          <svg viewBox="0 0 24 24" className="size-3.5 text-success" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span className="text-xs text-foreground">forms.yourbrand.com/feedback</span>
        </div>
      </div>
    )

  // submissions
  return (
    <div className="w-full max-w-[15rem] space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          SA
        </span>
        <div className="flex-1 space-y-1">
          <div className={`h-1.5 w-20 ${bar}`} />
          <div className={`h-1.5 w-12 ${bar}`} />
        </div>
        <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
          New
        </span>
      </div>
      <div className="rounded-lg border border-border bg-[color-mix(in_oklab,var(--accent)_55%,var(--background))] px-2.5 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          AI summary
        </span>
        <p className="text-[11px] leading-snug text-foreground">Strong fit. Wants more ownership.</p>
      </div>
    </div>
  )
}
