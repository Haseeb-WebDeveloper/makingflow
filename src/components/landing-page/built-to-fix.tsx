import { Reveal } from "./reveal"
import { ConversationLoop } from "./conversation-loop"

type IconName = "clock" | "wand" | "plug" | "shield"

const CARDS: { label?: string; title: string; body: string; icon: IconName; chip: string }[] = [
  {
    title: "Save hours every week",
    body: "Describe a form and it's built in a minute — not an afternoon of dragging fields around.",
    icon: "clock",
    chip: "bg-primary/10 text-primary",
  },
  {
    label: "No-code builder",
    title: "Type it. Reorder it. Done.",
    body: "Write what you need and edit any block by hand. No settings maze, no rule trees.",
    icon: "wand",
    chip: "bg-chart-3/10 text-chart-3",
  },
  {
    title: "Connect Sheets, webhooks & email",
    body: "Every response syncs where it needs to be, in real time, on its own.",
    icon: "plug",
    chip: "bg-chart-4/15 text-chart-4",
  },
  {
    label: "GDPR-minded security",
    title: "EU data, encrypted by default",
    body: "Export, deletion, and clear ownership are built in — not an afterthought.",
    icon: "shield",
    chip: "bg-success/10 text-success",
  },
]

export function BuiltToFix() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            MakingFlow is built to fix that.
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
            If you’re stuck between forms that don’t listen and tools that take all day to
            configure, this is for you.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          {/* A living conversational form — it listens and adapts, on a loop. */}
          <Reveal>
            <ConversationLoop />
          </Reveal>

          {/* 2×2 feature cards */}
          <div className="grid gap-5 sm:grid-cols-2">
            {CARDS.map((c, i) => (
              <Reveal key={c.title} delay={i * 80}>
                <div className="flex h-full flex-col rounded-xl border border-border bg-background p-5 sm:p-6">
                  <span className={`grid size-10 place-items-center rounded-lg ${c.chip}`}>
                    <FixIcon name={c.icon} />
                  </span>
                  {c.label ? (
                    <span className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {c.label}
                    </span>
                  ) : null}
                  <h3 className="mt-1 text-base font-semibold text-foreground">{c.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function FixIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "size-5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }
  if (name === "clock")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  if (name === "wand")
    return (
      <svg {...common}>
        <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M3 21l9-9" />
        <path d="M12.5 8.5 15 6l3 3-2.5 2.5" />
      </svg>
    )
  if (name === "plug")
    return (
      <svg {...common}>
        <path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v6" />
      </svg>
    )
  return (
    <svg {...common}>
      <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  )
}
