"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Icon, type IconName } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

type SettingsNavItem = { href: string; label: string; icon: IconName }

const SETTINGS_NAV: SettingsNavItem[] = [
  { href: "/settings/account", label: "Account", icon: "profile" },
  { href: "/settings/workspaces", label: "Workspaces", icon: "work" },
]

/** Determines active state — the workspace detail route lives under Workspaces. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/settings/workspaces") {
    return pathname.startsWith("/settings/workspace")
  }
  return pathname.startsWith(href)
}

export function SettingsNav() {
  const pathname = usePathname() ?? ""

  return (
    <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:gap-0.5 sm:overflow-visible">
      {SETTINGS_NAV.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon name={item.icon} className="size-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
