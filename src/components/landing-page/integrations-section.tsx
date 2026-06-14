import { Reveal } from "./reveal"

const PLACES = [
  {
    icon: "/logo/google-sheet.svg",
    name: "Google Sheets",
    body: "Every response becomes a row in its own spreadsheet, in real time. The sheet builds itself on the first answer.",
  },
  {
    icon: "/logo/webhook.svg",
    name: "Webhooks",
    body: "Send each submission straight to your own backend or automation. Retried on failure, never in the respondent's way.",
  },
  {
    icon: "/logo/email.svg",
    name: "Email",
    body: "Get notified the moment a response lands, with the answers in the message. No tab to keep open.",
  },
]

export function IntegrationsSection() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-20 lg:py-[5.556vw] sm:px-8 sm:py-28">
        <div className="grid gap-x-14 lg:gap-x-[3.889vw] gap-y-8 lg:gap-y-[2.222vw] lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <Reveal>
              <h2 className="max-w-md lg:max-w-[31.111vw] font-sebenta text-3xl lg:text-[2.083vw] font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                A few integrations that actually matter.
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-4 lg:mt-[1.111vw] max-w-[52ch] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground">
                We did not build a marketplace of seven thousand apps you will
                never open. We built the three places your answers genuinely need
                to be. Connect once, and they sync on every response.
              </p>
            </Reveal>
          </div>

          <ul className="grid gap-px overflow-hidden rounded-xl lg:rounded-[0.926vw] border border-border bg-border">
            {PLACES.map((p, i) => (
              <Reveal as="li" key={p.name} delay={i * 80} className="bg-background">
                <div className="flex items-start gap-4 lg:gap-[1.111vw] p-5 lg:p-[1.389vw] sm:p-6">
                  <span className="grid size-10 lg:size-[2.778vw] shrink-0 place-items-center rounded-lg lg:rounded-[0.694vw] border border-border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.icon} alt="" className="size-5 lg:size-[1.389vw]" />
                  </span>
                  <div className="max-w-[48ch]">
                    <h3 className="text-sm lg:text-[0.972vw] font-semibold text-foreground">{p.name}</h3>
                    <p className="mt-1 lg:mt-[0.278vw] text-sm lg:text-[0.972vw] leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
