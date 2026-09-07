/**
 * Turning the flat page list into the shapes the chrome needs.
 *
 * Pure and client-safe — the sidebar runs in the browser to read `usePathname()`,
 * so nothing here may touch the filesystem or the compiled MDX. Everything it
 * returns is plain serializable data, which is what lets a server layout build
 * the nav once and hand it down as a prop.
 */

import { DOCS_GROUPS, type DocsGroup } from "@/lib/docs/groups"
import { DOCS_PAGES, docHref, type DocsPage } from "@/lib/docs/pages"

export type DocsNavItem = {
  href: string
  title: string
  description: string
  icon: DocsPage["icon"]
}

export type DocsNavGroup = {
  id: DocsGroup["id"]
  title: string
  icon: DocsGroup["icon"]
  items: DocsNavItem[]
}

/**
 * Groups in `DOCS_GROUPS` order, pages in `DOCS_PAGES` order.
 *
 * Empty groups are dropped rather than rendered as headings with nothing under
 * them — the group list is seeded ahead of the content it will eventually hold,
 * and a reader should not see the gaps in our roadmap.
 */
export function buildNav(pages: readonly DocsPage[] = DOCS_PAGES): DocsNavGroup[] {
  return DOCS_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    icon: group.icon,
    items: pages
      .filter((page) => page.group === group.id)
      .map((page) => ({
        href: docHref(page),
        title: page.title,
        description: page.description,
        icon: page.icon,
      })),
  })).filter((group) => group.items.length > 0)
}

/**
 * Exact match only.
 *
 * `startsWith` is the reflex here and it is wrong: `/docs/webhooks` prefixes
 * `/docs/webhooks-advanced`, so a future page would light up its neighbour in
 * the sidebar. Doc URLs are leaves with no children, so there is nothing an
 * exact match fails to cover.
 */
export function isDocsNavActive(pathname: string, href: string): boolean {
  return pathname === href
}

export type DocsAdjacent = {
  previous: DocsNavItem | null
  next: DocsNavItem | null
}

/** Prev/next in reading order, crossing group boundaries as a reader would. */
export function findAdjacent(
  slug: string,
  pages: readonly DocsPage[] = DOCS_PAGES,
): DocsAdjacent {
  const index = pages.findIndex((p) => p.slug === slug)
  if (index === -1) return { previous: null, next: null }

  const toItem = (page: DocsPage | undefined): DocsNavItem | null =>
    page
      ? {
          href: docHref(page),
          title: page.title,
          description: page.description,
          icon: page.icon,
        }
      : null

  return { previous: toItem(pages[index - 1]), next: toItem(pages[index + 1]) }
}
