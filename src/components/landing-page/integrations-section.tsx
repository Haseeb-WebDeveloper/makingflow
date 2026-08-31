import { Reveal } from "./reveal"

const PLACES: {
  icon: string
  name: string
  body: string
  tag: string
  tile: string
}[] = [
  {
    icon: "/logo/google-sheet.svg",
    name: "Google Sheets",
    body: "Every response becomes a row in its own spreadsheet, in real time. The sheet builds itself on the first answer.",
    tag: "Real-time",
    tile: "bg-success/10",
  },
  {
    icon: "/logo/webhook.svg",
    name: "Webhooks",
    body: "Send each submission straight to your own backend or automation. Retried on failure, never in the respondent's way.",
    tag: "Retried on fail",
    tile: "bg-chart-4/10",
  },
  {
    icon: "/logo/email.svg",
    name: "Email",
    body: "Get notified the moment a response lands, with the answers in the message. No tab to keep open.",
    tag: "Instant",
    tile: "bg-chart-3/10",
  },
]

export function IntegrationsSection() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-x-14 gap-y-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <Reveal>
              <h2 className="max-w-md text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
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

          <ul className="space-y-3">
            {PLACES.map((p, i) => (
              <Reveal as="li" key={p.name} delay={i * 80}>
                <div className="flex items-start gap-4 rounded-xl border border-border bg-background p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${p.tile}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.icon} alt="" className="size-5" />
                  </span>
                  <div className="min-w-0 max-w-[48ch] flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                        <span className="size-1.5 rounded-full bg-success" />
                        {p.tag}
                      </span>
                    </div>
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
