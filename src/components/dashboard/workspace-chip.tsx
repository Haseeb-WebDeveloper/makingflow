import Link from "next/link"

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
}

/**
 * Sidebar workspace identity — name + plan. v1 ships one workspace per user, so
 * this isn't a switcher yet; it links to settings. Reads cleanly when the
 * sidebar collapses to icon mode (hidden via group-data).
 */
export function WorkspaceChip({
  name,
  plan,
  href = "/settings",
}: {
  name: string
  plan: string
  href?: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded border border-sidebar-border bg-sidebar-accent px-2.5 py-2 transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded bg-foreground text-[11px] font-semibold text-background">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-sidebar-foreground">
          {name}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {PLAN_LABEL[plan] ?? plan} plan
        </span>
      </span>
    </Link>
  )
}
