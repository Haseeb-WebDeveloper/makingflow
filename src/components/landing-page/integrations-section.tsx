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
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-x-14 gap-y-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <Reveal>
              <h2 className="max-w-md font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
                A few integrations that actually matter.
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
                We did not build a marketplace of seven thousand apps you will
                never open. We built the three places your answers genuinely need
                to be. Connect once, and they sync on every response.
              </p>
            </Reveal>
          </div>

          <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border">
            {PLACES.map((p, i) => (
              <Reveal as="li" key={p.name} delay={i * 80} className="bg-background">
                <div className="flex items-start gap-4 p-5 sm:p-6">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.icon} alt="" className="size-5" />
                  </span>
                  <div className="max-w-[48ch]">
                    <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
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
