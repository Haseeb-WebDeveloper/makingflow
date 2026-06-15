import type { IconName } from "@/components/ui/icon"

export type DashboardNavItem = {
  /** Destination route. Omit for action items (e.g. Search opens a dialog). */
  href?: string
  label: string
  icon: IconName
  /** Special behavior instead of navigation. */
  action?: "search"
  /** Render a muted "Soon" affordance and disable navigation. */
  comingSoon?: boolean
}

// The builder app's primary navigation. Forms are listed separately below these
// items in the sidebar (see DashboardShell).
export const MAKINGFLOW_NAV: DashboardNavItem[] = [
  { href: "/forms", label: "Home", icon: "home" },
  { label: "Search", icon: "search", action: "search" },
  { href: "/domains", label: "Domains", icon: "discovery" },
  { href: "/integrations", label: "Integrations", icon: "swap" },
  { href: "/settings", label: "Settings", icon: "setting" },
]

export function isDashboardNavActive(pathname: string, href: string): boolean {
  // Home (/forms) stays active across the whole forms area EXCEPT a specific
  // form's detail/edit pages (those light up the form in the Forms list).
  if (href === "/forms") {
    return pathname === "/forms"
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
