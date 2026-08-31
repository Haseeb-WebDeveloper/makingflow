import { Reveal } from "./reveal"

const STATS = [
  { value: "1 min", label: "From a sentence to a live form" },
  { value: "30+", label: "Languages, on autopilot" },
  { value: "20+", label: "Field & content types" },
  { value: "0", label: "Dashboards to set up" },
]

/** Bold electric-blue band with lime numbers — a punchy break between the hero
 *  and the story sections, in the spirit of the reference landing pages. */
export function StatsBand() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      {/* a soft lime glow in the corner so the band isn't a flat rectangle */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--secondary)_55%,transparent),transparent)] blur-2xl"
      />
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <div className="text-center lg:text-left">
                <p className="text-4xl font-bold tracking-tight text-secondary sm:text-5xl">
                  {s.value}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-primary-foreground/75">
                  {s.label}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
