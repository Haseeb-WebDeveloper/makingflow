import { SVGIcon } from "@/components/ui/svg-icon"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Integrations, loading.
 *
 * ALMOST NOTHING HERE IS ACTUALLY UNKNOWN. Which integrations exist, what they
 * are called, what their logos look like and how the page is grouped are all
 * fixed — the only thing a query decides is whether each one is connected, what
 * its current state says, and therefore which button its footer carries.
 *
 * So the page draws itself in full and greys out three slots per card: the
 * status badge, the description (its wording differs connected vs not, and
 * showing the disconnected copy to someone who IS connected would be a
 * sentence that rewrites itself), and the footer action.
 *
 * The effect is a page that looks finished on arrival and fills in, rather than
 * six grey rectangles that resolve into a layout.
 */

/** Same chrome as `CardShell`, without pulling a client component in here. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4">
      {children}
    </div>
  )
}

/**
 * One integration card: real logo, real name, everything stateful greyed.
 *
 * `descriptionLines` matches how far each card's copy actually wraps, so the
 * grid rows do not resize when the text arrives.
 */
export function IntegrationCardSkeleton({
  icon,
  name,
  descriptionLines = 3,
}: {
  icon: string
  name: string
  descriptionLines?: number
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <SVGIcon src={icon} preserveColors className="size-9" />
        {/* The connected pill, at the size it renders. */}
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      <h3 className="mt-3 text-sm font-semibold text-foreground">{name}</h3>

      <div className="mt-1 flex-1 space-y-1.5">
        {Array.from({ length: descriptionLines }, (_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            // The last line of a paragraph is short. Full-width bars all the
            // way down read as a block, not as prose.
            style={{ width: i === descriptionLines - 1 ? "55%" : "100%" }}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
    </Card>
  )
}

export function IntegrationsSkeleton() {
  return (
    <div className="mt-6">
      {/* The MCP hero is entirely static apart from its secondary action —
          same background, same headline, same copy, same primary button. */}
      <div
        className="relative overflow-hidden rounded-2xl bg-[#141636] bg-cover bg-center text-white"
        style={{ backgroundImage: "url('/mcp-bg.jpg')" }}
      >
        <div className="px-6 py-10 sm:px-10 sm:py-12">
          <h2 className="max-w-2xl text-2xl font-semibold leading-[1.2] tracking-tight sm:text-[2rem]">
            Bring MakingFlow into your AI assistant
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/90 sm:text-[0.9375rem]">
            Connect Claude, ChatGPT, Cursor or any MCP client to this workspace.
            It can build forms, publish them, read responses and answer
            questions about how they are performing — from wherever you already
            work.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Whether this says "Connect an assistant" or "New connection"
                depends on the query, so it stays a block rather than flipping
                its label a moment after you have read it. */}
            <Skeleton className="h-10 w-52 rounded-md bg-white/20" />
            <Skeleton className="h-10 w-32 rounded-md bg-white/10" />
          </div>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-foreground">
          Connected once, used everywhere
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the account and every form in this workspace uses it —
          including forms you make later.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCardSkeleton
            icon="/logo/google-sheet.svg"
            name="Google Sheets"
          />
          <IntegrationCardSkeleton icon="/logo/notion.svg" name="Notion" />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-foreground">Set up per form</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each form has its own — a new form starts with none. Choose a form to
          configure it.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCardSkeleton
            icon="/logo/email.svg"
            name="Email notifications"
          />
          <IntegrationCardSkeleton icon="/logo/webhook.svg" name="Webhooks" />
          <IntegrationCardSkeleton icon="/logo/discord.svg" name="Discord" />
        </div>
      </section>
    </div>
  )
}
