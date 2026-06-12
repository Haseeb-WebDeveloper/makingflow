import type { IconName } from "@/components/ui/icon"

export type DashboardNavItem = {
  href: string
  label: string
  icon: IconName
}

// The builder app's primary navigation. Each entry is its own top-level
// section (no shared root prefix like homei's /contractor).
export const MAKINGFLOW_NAV: DashboardNavItem[] = [
  { href: "/forms", label: "Forms", icon: "document" },
  { href: "/submissions", label: "Submissions", icon: "folder" },
  { href: "/analytics", label: "Analytics", icon: "chart" },
  { href: "/templates", label: "Templates", icon: "category" },
  { href: "/settings", label: "Settings", icon: "setting" },
]

export function isDashboardNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
