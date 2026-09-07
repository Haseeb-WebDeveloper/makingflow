import Link from "next/link"
import type { DocsAdjacent } from "@/lib/docs/nav"

/**
 * Previous / next, in reading order.
 *
 * Crosses group boundaries deliberately — someone working through the docs
 * front to back should not hit a dead end at the last page of a section with no
 * indication there is more.
 */
export function DocsPager({ previous, next }: DocsAdjacent) {
  if (!previous && !next) return null

  return (
    <nav
      aria-label="Documentation pages"
      className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
    >
      {previous ? (
        <Link
          href={previous.href}
          className="group flex flex-col gap-1 rounded-lg border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/50"
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden>←</span>
            Previous
          </span>
          <span className="text-sm font-medium text-foreground">{previous.title}</span>
        </Link>
      ) : (
        // Keeps "next" in the right-hand column when there is no previous.
        <span aria-hidden />
      )}

      {next ? (
        <Link
          href={next.href}
          className="group flex flex-col gap-1 rounded-lg border border-border p-4 text-right transition-colors hover:border-foreground/30 hover:bg-muted/50 sm:items-end"
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Next
            <span aria-hidden>→</span>
          </span>
          <span className="text-sm font-medium text-foreground">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  )
}
