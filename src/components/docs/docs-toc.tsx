"use client"

import * as React from "react"
import type { DocHeading } from "@/lib/docs/source"
import { cn } from "@/lib/utils"

/**
 * On this page.
 *
 * The webhooks document is ten sections long; without this the only way to see
 * its shape is to scroll it. The headings come from the same `parseHeading` the
 * heading components use, so every entry here points at an anchor that exists.
 *
 * SCROLLSPY CAVEAT: `IntersectionObserver` is stubbed in `vitest.setup.ts` with
 * an `observe()` that never fires, so a unit test asserting the active heading
 * changes on scroll would pass without exercising anything and keep passing if
 * this were deleted. Real coverage belongs in Playwright.
 */
export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = React.useState<string | null>(headings[0]?.id ?? null)

  React.useEffect(() => {
    if (headings.length === 0) return

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // The top-most heading currently inside the band. Taking the first
        // intersecting entry in DOM order rather than the most recent one keeps
        // the highlight from jumping backwards when scrolling up past a short
        // section.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.id)
        if (visible.length > 0) {
          const first = headings.find((h) => visible.includes(h.id))
          if (first) setActiveId(first.id)
        }
      },
      // Only the top third of the viewport counts as "where the reader is
      // looking", so a heading becomes active as it reaches the top rather than
      // the moment it appears at the bottom.
      { rootMargin: "0px 0px -67% 0px", threshold: 0 },
    )

    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav aria-label="On this page">
      <p className="mb-2 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        On this page
      </p>
      <ul className="space-y-0.5 border-l border-border">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              onClick={() => setActiveId(heading.id)}
              className={cn(
                "-ml-px block border-l py-1 text-sm transition-colors",
                heading.depth === 3 ? "pl-6" : "pl-3",
                activeId === heading.id
                  ? "border-l-foreground font-medium text-foreground"
                  : "border-l-transparent text-foreground/65 hover:text-foreground",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
