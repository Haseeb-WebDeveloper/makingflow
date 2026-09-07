/**
 * Every documentation page, in order.
 *
 * THE ONE HAND-MAINTAINED LIST. Sidebar, table of contents, breadcrumb,
 * prev/next, search index, sitemap and `generateStaticParams` all derive from
 * it, so adding a page is this file plus the `.mdx` — and `docs-registry.test.ts`
 * fails if either exists without the other.
 *
 * Metadata lives here rather than in frontmatter for two reasons. `@next/mdx`
 * does not support frontmatter without plugins, and plugin options must survive
 * a JS→Rust boundary under Turbopack. More importantly, the nav needs the title
 * and description of EVERY page at once; reading them from the files would mean
 * importing every MDX module just to draw a sidebar, which drags all of the
 * content into whatever bundle touches it.
 *
 * Deliberately pure and free of MDX imports, so client components and tests can
 * import it directly. The compiled bodies live next door in `content.ts`, which
 * is `server-only` precisely because it does import them.
 *
 * Array order IS sidebar and prev/next order.
 */

import type { IconName } from "@/components/ui/icon"
import type { DocsGroupId } from "@/lib/docs/groups"

export type DocsPage = {
  /** URL segment: `/docs/<slug>`. Also the `.mdx` basename. */
  slug: string
  title: string
  /** One sentence. Used under the h1, in the nav tooltip and as page metadata. */
  description: string
  group: DocsGroupId
  icon: IconName
}

export const DOCS_PAGES: readonly DocsPage[] = [
  {
    slug: "webhooks",
    title: "Webhooks",
    description:
      "Receive every MakingFlow form submission as a signed JSON POST. Payload, signature verification, retries and delivery guarantees.",
    group: "integrations",
    icon: "swap",
  },
  {
    slug: "mcp",
    title: "MCP server",
    description:
      "Connect Claude, ChatGPT, Le Chat, Perplexity or any MCP client to your workspace to build forms and read responses.",
    group: "ai",
    icon: "chat",
  },
]

/**
 * `/docs/webhooks` and `/docs/mcp` are published outside this app — in the MCP
 * discovery documents (`resource_documentation`, `service_documentation`) and
 * from the in-app webhooks card. Renaming either slug breaks a URL we have told
 * other people to rely on, so the registry test pins these by name.
 */
export const PINNED_SLUGS = ["webhooks", "mcp"] as const

export function docBySlug(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find((p) => p.slug === slug)
}

export function docHref(page: Pick<DocsPage, "slug">): string {
  return `/docs/${page.slug}`
}
