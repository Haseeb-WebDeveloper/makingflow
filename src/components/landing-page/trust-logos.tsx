import { Reveal } from "./reveal"

// Placeholder wordmarks — swap for real customer logos when available.
const LOGOS = ["Northwind", "Lumen", "Vertex", "Atlas", "Quill", "Cobalt"]

export function TrustLogos() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <Reveal>
          <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Trusted by teams who collect a lot of answers
          </p>
        </Reveal>
        <Reveal delay={80}>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 opacity-55">
            {LOGOS.map((l) => (
              <span
                key={l}
                className="text-lg font-bold tracking-tight text-muted-foreground"
              >
                {l}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
