import Link from "next/link"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

const PLANS: {
  name: string
  price: string
  period?: string
  blurb: string
  features: string[]
  cta: string
  href: string
  featured?: boolean
}[] = [
  {
    name: "Free",
    price: "€0",
    blurb: "For individuals and small teams",
    features: [
      "Up to 3 forms",
      "Core field types & logic",
      "100 responses / month",
      "Community support",
    ],
    cta: "Get started",
    href: "/auth/signup",
  },
  {
    name: "Pro",
    price: "€19",
    period: "/month",
    blurb: "For growing businesses",
    features: [
      "Unlimited forms",
      "AI builder + conversational mode",
      "Built-in analytics & summaries",
      "Sheets, webhooks & email",
      "Priority support",
    ],
    cta: "Get started",
    href: "/auth/signup",
    featured: true,
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-4 text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            Flexible plans for every business.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            From start-up to enterprise, there is a plan that scales with you.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-2xl gap-5 sm:grid-cols-2">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80} className="h-full">
              <div
                className={
                  "flex h-full flex-col rounded-lg border bg-background p-6 " +
                  (p.featured
                    ? "border-primary ring-1 ring-primary/20"
                    : "border-border")
                }
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-foreground">{p.name}</h3>
                  {p.featured ? (
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      Most popular
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-foreground">
                    {p.price}
                  </span>
                  {p.period ? (
                    <span className="text-sm text-muted-foreground">{p.period}</span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.blurb}</p>

                <ul className="mt-6 flex-1 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                      <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={p.href}
                  className={
                    "mt-7 inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-medium transition-colors " +
                    (p.featured
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-foreground text-background hover:bg-foreground/90")
                  }
                >
                  {p.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
