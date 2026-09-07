import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { DocsPageActions } from "@/components/docs/docs-page-actions"
import { DocsPager } from "@/components/docs/docs-pager"
import { DocsToc } from "@/components/docs/docs-toc"
import { docBody } from "@/lib/docs/content"
import { groupById } from "@/lib/docs/groups"
import { findAdjacent } from "@/lib/docs/nav"
import { DOCS_PAGES, docBySlug } from "@/lib/docs/pages"
import { docMarkdown } from "@/lib/docs/markdown"
import { mcpEndpoint, siteUrl } from "@/lib/docs/site-url"
import { extractHeadings, readDocSource } from "@/lib/docs/source"

/**
 * Every documentation page.
 *
 * NO `dynamicParams = false`, even though it is the obvious way to make unknown
 * slugs 404 at the routing layer: under `cacheComponents` Next rejects the
 * segment config outright ("not compatible with nextConfig.cacheComponents").
 * The `notFound()` below is therefore load-bearing rather than defensive — it
 * is the only thing standing between `/docs/anything` and a crash.
 *
 * `generateStaticParams` still earns its place: it prerenders every real page
 * at build. Under `cacheComponents` it must return at least one param, which
 * `docs-content.test.ts` asserts so an empty registry fails as a unit test
 * rather than as a build error about static params.
 *
 * A single dynamic segment rather than a catch-all: doc URLs are flat by
 * design. Grouping is metadata on the registry entry, not a path segment —
 * which is what keeps /docs/webhooks and /docs/mcp at exactly the URLs the MCP
 * discovery documents and the in-app webhooks card already publish.
 */
export function generateStaticParams() {
  return DOCS_PAGES.map((page) => ({ slug: page.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = docBySlug(slug)
  if (!page) return {}

  return {
    title: `${page.title} · MakingFlow docs`,
    description: page.description,
    openGraph: { title: page.title, description: page.description, type: "article" },
  }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = docBySlug(slug)
  const body = docBody(slug)
  // The 404 for every URL that is not a real page, and the guard for a registry
  // entry whose body was never added to content.tsx.
  if (!page || !body) notFound()

  const group = groupById(page.group)
  const headings = extractHeadings(readDocSource(slug))
  const { previous, next } = findAdjacent(slug)
  const markdown = docMarkdown(slug) ?? ""

  return (
    <div className="flex min-w-0 flex-1">
      {/* The article is centred in whatever space is left between the rails and
          capped for line length; the rails themselves stay pinned to the
          viewport edges however wide the display gets. */}
      <article className="mx-auto min-w-0 max-w-3xl flex-1 px-5 py-8 sm:px-8 lg:py-12">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
          {group ? (
            <>
              <span aria-hidden>/</span>
              <span>{group.title}</span>
            </>
          ) : null}
        </nav>

        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {page.title}
          </h1>
          <DocsPageActions
            markdown={markdown}
            markdownUrl={`${siteUrl()}/docs/${slug}/md`}
            pageUrl={`${siteUrl()}/docs/${slug}`}
            mcpEndpoint={mcpEndpoint()}
          />
        </div>
        <p className="mt-2 text-base leading-relaxed text-foreground/70">{page.description}</p>

        <div className="mt-8">{body}</div>

        <DocsPager previous={previous} next={next} />

        <p className="mt-8 text-xs text-muted-foreground">
          Something wrong or missing on this page?{" "}
          <a
            href={`mailto:hello@makingflow.com?subject=${encodeURIComponent(`Docs: ${page.title}`)}`}
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            Tell us
          </a>
          .
        </p>
      </article>

      <aside className="thin-scroll sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-l border-border px-4 py-8 lg:py-12 xl:block">
        <DocsToc headings={headings} />
      </aside>
    </div>
  )
}
