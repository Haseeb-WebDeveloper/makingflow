import { Reveal } from "./reveal"

export function WhySection() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-sm font-medium text-primary">Why we built this</p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 max-w-3xl font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            Most forms collect answers. They never understand them.
          </h2>
        </Reveal>

        <div className="mt-9 grid gap-x-14 gap-y-6 sm:grid-cols-2">
          <Reveal delay={120}>
            <p className="max-w-[60ch] text-base leading-relaxed text-muted-foreground">
              For years you have had to pick a side. A form that looks calm and
              reads well, but treats a thoughtful reply and a one word shrug
              exactly the same. Or a clever tool buried in so many settings that
              building a single question turns into an afternoon.
            </p>
          </Reveal>
          <Reveal delay={200}>
            <p className="max-w-[60ch] text-base leading-relaxed text-muted-foreground">
              MakingFlow keeps the quiet, document style editing you actually
              enjoy, and adds the part that was always missing. A form that pays
              attention while someone fills it out, and gives you back answers
              that are ready to read.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
