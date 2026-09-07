"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Icon } from "@/components/ui/icon"
import { isDocsNavActive, type DocsNavGroup } from "@/lib/docs/nav"
import { cn } from "@/lib/utils"

/**
 * The documentation tree.
 *
 * Built on the shape `settings-nav.tsx` uses rather than `ui/sidebar.tsx`,
 * which is the right call for this surface and worth recording. `SidebarProvider`
 * sets `h-dvh overflow-hidden` so the page itself never scrolls — correct for an
 * app shell, wrong for a public page that has to end in a footer, restore scroll
 * on back, and jump to `#anchors`. It also binds ⌘B globally and reads a cookie
 * for its default state, which would make this route dynamic.
 *
 * So: a plain nav in a sticky aside, with the document as the scroll container.
 *
 * Takes its data as a prop. The layout builds the tree on the server and passes
 * plain strings, so nothing here imports the page registry — and therefore
 * nothing pulls the compiled MDX into the client bundle.
 */
export function DocsSidebar({
  nav,
  onNavigate,
}: {
  nav: DocsNavGroup[]
  /** Lets the mobile sheet close itself when a link is followed. */
  onNavigate?: () => void
}) {
  const pathname = usePathname() ?? ""

  return (
    <nav className="space-y-6" aria-label="Documentation">
      {nav.map((group) => (
        <div key={group.id}>
          <p className="mb-2 flex items-center gap-2 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Icon name={group.icon} className="size-3.5" aria-hidden />
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isDocsNavActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-foreground/70 hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
