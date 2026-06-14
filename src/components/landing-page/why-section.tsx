import { Reveal } from "./reveal"

export function WhySection() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-sm lg:text-[0.972vw] font-medium text-primary">Why we built this</p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 lg:mt-[1.111vw] max-w-3xl lg:max-w-[53.333vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            Most forms collect answers. They never understand them.
          </h2>
        </Reveal>

        <div className="mt-9 lg:mt-[2.5vw] grid gap-x-14 lg:gap-x-[3.889vw] gap-y-6 lg:gap-y-[1.667vw] sm:grid-cols-2">
          <Reveal delay={120}>
            <p className="max-w-[60ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
              For years you have had to pick a side. A form that looks calm and
              reads well, but treats a thoughtful reply and a one word shrug
              exactly the same. Or a clever tool buried in so many settings that
              building a single question turns into an afternoon.
            </p>
          </Reveal>
          <Reveal delay={200}>
            <p className="max-w-[60ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
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
