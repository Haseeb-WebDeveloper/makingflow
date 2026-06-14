import { Reveal } from "./reveal"

const STEPS = [
  {
    n: "01",
    title: "Describe it in a sentence.",
    body: "Write what you need the way you would say it out loud. “A job application for a senior motion designer, ask for a showreel and availability.” The form assembles as you type, and you can edit any block by hand.",
  },
  {
    n: "02",
    title: "It adapts as people answer.",
    body: "When a reply is thin, it asks a natural follow up. When a question does not apply, it quietly skips it. Everyone fills it out in their own language, and the answers come back in yours.",
  },
  {
    n: "03",
    title: "You read clean answers.",
    body: "Each response lands organized, with a short summary at the top. Skim them in the inbox, export to a sheet, or send them straight to the tools your team already uses.",
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-t border-border bg-muted/30">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-2xl lg:max-w-[46.667vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            From a sentence to a working form, in about a minute.
          </h2>
        </Reveal>

        <div className="mt-12 lg:mt-[3.333vw] overflow-hidden rounded-xl lg:rounded-[0.926vw] border border-border bg-border">
          <div className="grid gap-px">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80} className="bg-background">
                <div className="grid gap-3 lg:gap-[0.833vw] p-6 lg:p-[1.667vw] sm:grid-cols-[auto_1fr] sm:items-baseline sm:gap-9 sm:p-8">
                  <span className="font-sebenta text-2xl lg:text-[1.667vw] font-bold text-primary sm:text-3xl">
                    {s.n}
                  </span>
                  <div className="max-w-[62ch]">
                    <h3 className="text-lg lg:text-[1.25vw] font-semibold text-foreground">{s.title}</h3>
                    <p className="mt-2 lg:mt-[0.556vw] leading-relaxed text-muted-foreground">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
