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
      className="flex items-center gap-2.5 lg:gap-[0.694vw] rounded lg:rounded-[0.324vw] border border-sidebar-border bg-sidebar-accent px-2.5 lg:px-[0.694vw] py-2 lg:py-[0.556vw] transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
    >
      <span className="flex size-7 lg:size-[1.944vw] shrink-0 items-center justify-center rounded lg:rounded-[0.324vw] bg-foreground text-[11px] lg:text-[0.764vw] font-semibold text-background">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm lg:text-[0.972vw] font-medium text-sidebar-foreground">
          {name}
        </span>
        <span className="truncate text-xs lg:text-[0.833vw] text-muted-foreground">
          {PLAN_LABEL[plan] ?? plan} plan
        </span>
      </span>
    </Link>
  )
}
