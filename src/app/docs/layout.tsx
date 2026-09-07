import { DocsHeader } from "@/components/docs/docs-header"
import { DocsSearchProvider } from "@/components/docs/docs-search"
import { DocsSidebar } from "@/components/docs/docs-sidebar"
import { buildNav } from "@/lib/docs/nav"
import { buildSearchIndex } from "@/lib/docs/source"

/**
 * The documentation shell.
 *
 * Before this existed, `src/app/docs/` held two pages and nothing else: no
 * layout, no index, no link between them. Each was reachable only from a single
 * deep link — one from a button in the app, the other from a field in the MCP
 * discovery document — so a reader who found one had no way to discover the
 * other.
 *
 * NO SITE FOOTER. The marketing footer is five columns of links to pricing,
 * socials and a newsletter — on a reference page it is a wall of unrelated
 * navigation under the thing the reader came for, and with sticky rails it
 * would sit below two full-height columns where nobody scrolls to find it.
 * The page ends with prev/next instead, which is where a reader actually
 * wants to go next.
 *
 * FULL-BLEED CHROME, MEASURED PROSE. The header and both rails run to the edges
 * of the viewport at every width; only the article is capped. Constraining the
 * whole row instead — the obvious `max-w-7xl` on the container — leaves the
 * rails floating somewhere in the middle of a wide display with dead space
 * outside them, which reads as a bug rather than as a margin. The line length a
 * reader needs and the position of the navigation are two different problems.
 *
 * NO `<main>` HERE. The root layout already renders one, and both old pages
 * rendered their own inside it, which is invalid nesting. The page renders an
 * `<article>` instead.
 *
 * Both derived values are computed on the server and handed down as plain data:
 * the nav so the client sidebar never imports the page registry, and the search
 * index so the ⌘K dialog needs no request. `buildSearchIndex` reads the .mdx
 * files with SYNCHRONOUS fs, which Next documents as completing during
 * prerender — `fs/promises` here would make every docs page dynamic. If the
 * build output ever stops marking these routes `○ (Static)`, that is the first
 * thing to check.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const nav = buildNav()
  const searchIndex = buildSearchIndex()

  return (
    <DocsSearchProvider index={searchIndex}>
      <div className="flex min-h-dvh flex-col bg-background">
        <DocsHeader nav={nav} />

        <div className="flex w-full flex-1">
          {/* Sticky under the h-14 header, with the document as the scroll
              container — which is what keeps #anchors and back-button scroll
              restoration working natively. */}
          <aside className="thin-scroll sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-border px-4 py-8 lg:block">
            <DocsSidebar nav={nav} />
          </aside>

          {children}
        </div>
      </div>
    </DocsSearchProvider>
  )
}
