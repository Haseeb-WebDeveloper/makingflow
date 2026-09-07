import type { Metadata } from "next"
import Link from "next/link"
import { Icon } from "@/components/ui/icon"
import { DOCS_GROUPS } from "@/lib/docs/groups"
import { buildNav } from "@/lib/docs/nav"
import { cn } from "@/lib/utils"

/**
 * The documentation landing page.
 *
 * `/docs` was a 404 until now — the two pages that existed were reachable only
 * by deep link, so there was nowhere to send someone who just wants to know
 * what is documented.
 *
 * A hand-written page rather than an `index.mdx`, because it is a directory
 * rather than a document: it should show what exists at a glance, including the
 * shape of what does not yet.
 */
export const metadata: Metadata = {
  title: "Documentation · MakingFlow",
  description:
    "Build against MakingFlow: webhooks, the MCP server, and everything else you need to integrate.",
}

/** Sections with nothing in them yet, named so the shape is legible. */
const PLANNED: Partial<Record<(typeof DOCS_GROUPS)[number]["id"], string>> = {
  "getting-started": "Creating your first form, publishing, and sharing it.",
  forms: "Field types, conditional logic, and submission controls.",
  reference: "Payload shapes, limits and error codes.",
}

export default function DocsIndexPage() {
  const nav = buildNav()
  const filled = new Set(nav.map((group) => group.id))

  return (
    <div className="flex min-w-0 flex-1">
      <article className="mx-auto min-w-0 max-w-3xl flex-1 px-5 py-8 sm:px-8 lg:py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Documentation
        </h1>
        <p className="mt-2 text-base leading-relaxed text-foreground/70">
          How to build against MakingFlow. These pages are public and need no account — they are
          written to be sent to whoever is writing the code.
        </p>

        <div className="mt-10 space-y-10">
          {nav.map((group) => (
            <section key={group.id}>
              <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                <Icon name={group.icon} className="size-3.5" aria-hidden />
                {group.title}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-lg border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/50",
                      // A lone card in a two-column grid reads as a layout bug
                      // rather than as a section with one page in it.
                      group.items.length === 1 && "sm:col-span-2",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Icon name={item.icon} className="size-4" aria-hidden />
                      {item.title}
                    </span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-foreground/70">
                      {item.description}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Honest about the gaps rather than hiding them: a reader looking for
            form documentation should learn it is coming, not conclude the
            product has none. */}
        <section className="mt-12 border-t border-border pt-6">
          <h2 className="text-sm font-medium text-foreground">Coming next</h2>
          <ul className="mt-3 space-y-2">
            {DOCS_GROUPS.filter((group) => !filled.has(group.id) && PLANNED[group.id]).map(
              (group) => (
                <li key={group.id} className="flex gap-2.5 text-sm text-foreground/80">
                  <Icon name={group.icon} className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <strong className="font-medium text-foreground">{group.title}</strong> —{" "}
                    {PLANNED[group.id]}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      </article>

      {/* Mirrors the table-of-contents rail on a document page, so the content
          column sits in the same place whichever /docs page you are on. */}
      <div aria-hidden className="hidden w-60 shrink-0 xl:block" />
    </div>
  )
}
