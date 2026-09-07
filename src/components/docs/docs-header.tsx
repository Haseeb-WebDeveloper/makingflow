"use client"

import * as React from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { DocsMobileNav } from "@/components/docs/docs-mobile-nav"
import { useDocsSearch } from "@/components/docs/docs-search"
import { Icon } from "@/components/ui/icon"
import { Kbd } from "@/components/ui/kbd"
import { SVGIcon } from "@/components/ui/svg-icon"
import type { DocsNavGroup } from "@/lib/docs/nav"

/**
 * The documentation header.
 *
 * NOT `SiteHeader`, for three reasons that each rule it out on their own:
 *
 *   - it is `absolute top-0`, so the sidebar and table of contents would have
 *     nothing to stick beneath;
 *   - its links are landing-page hash anchors (`#features`), which from
 *     /docs/webhooks resolve to `/docs/webhooks#features` and scroll nowhere;
 *   - it takes `isAuthed`, which every caller gets from `await getOptionalUser()`
 *     — request-scoped data that would make this whole layout dynamic. These
 *     pages are public, identical for everyone, and indexed; keeping them
 *     prerendered matters more than personalising one button.
 *
 * Hence a static "Open app" link to /forms, which `proxy.ts` already redirects
 * to login when signed out. No auth read, no dynamic hole.
 */
export function DocsHeader({ nav }: { nav: DocsNavGroup[] }) {
  const { resolvedTheme, setTheme } = useTheme()
  const search = useDocsSearch()

  // next-themes only knows the resolved theme in the browser. Reading it during
  // render would mismatch the prerendered HTML, so the icon waits for mount.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur">
      {/* Full bleed, like the rails below it. A centred max-width here would
          leave the logo drifting away from the sidebar it sits above. */}
      <div className="flex h-14 w-full items-center gap-3 px-4 sm:px-6">
        <DocsMobileNav nav={nav} />

        <Link href="/" className="flex items-center gap-1.5 font-semibold tracking-tight" aria-label="MakingFlow home">
          <SVGIcon src="/logo/logo.svg" preserveColors className="size-5 rounded" />
          <span className="hidden sm:inline">MakingFlow</span>
        </Link>
        <Link
          href="/docs"
          className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Docs
        </Link>

        <div className="flex-1" />

        <button
          type="button"
          onClick={search.open}
          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="search" className="size-3.5" />
          <span className="hidden sm:inline">Search</span>
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </button>

        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name={mounted && resolvedTheme === "dark" ? "sun" : "moon"} className="size-4" />
        </button>

        <Link
          href="/forms"
          className="hidden rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:inline-block"
        >
          Open app
        </Link>
      </div>
    </header>
  )
}
