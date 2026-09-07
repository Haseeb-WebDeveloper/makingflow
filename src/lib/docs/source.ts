import "server-only"

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DOCS_PAGES, type DocsPage } from "@/lib/docs/pages"
import { groupById } from "@/lib/docs/groups"
import { parseHeading } from "@/lib/docs/slugify"

/**
 * Reading the MDX sources as text, for the things the rendered output cannot
 * give us: the table of contents and the search index.
 *
 * SYNCHRONOUS `fs` THROUGHOUT. Next documents sync I/O as completing during
 * prerender, so these routes stay static HTML. `fs/promises` would read as
 * uncached data and make every docs page dynamic — on a public, indexed surface
 * that is the difference between a CDN hit and a server render per visitor.
 * If you change one of these to `await`, check the build output still marks the
 * docs routes `○ (Static)`.
 *
 * Parsing the source rather than the rendered tree is the simpler half of a
 * choice: extracting headings from React output would mean rendering every page
 * to build the nav for one. The cost is that the two must agree on what a
 * heading is called, which is why both go through `parseHeading`.
 */

const CONTENT_DIR = join(process.cwd(), "src", "content", "docs")

/** ```fenced blocks``` — stripped before anything else looks for `#` or `<`. */
const FENCED_CODE = /^```[\s\S]*?^```$/gm
/** {/* MDX comments *​/} */
const MDX_COMMENT = /\{\s*\/\*[\s\S]*?\*\/\s*\}/g
const IMPORT_LINE = /^import\s.+$/gm
const EXPORT_BLOCK = /^export\s[\s\S]*?^\}/gm
const JSX_TAG = /<\/?[A-Za-z][^>]*>/g
const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g
const MD_EMPHASIS = /[*_`]+/g

export function readDocSource(slug: string): string {
  return readFileSync(join(CONTENT_DIR, `${slug}.mdx`), "utf8")
}

export type DocHeading = {
  id: string
  text: string
  /** 2 or 3. h1 is the page title and lives outside the body. */
  depth: 2 | 3
}

/**
 * Headings for the table of contents.
 *
 * Code fences are removed first because a `# comment` on the first line of a
 * bash sample is not a section — and the webhook receiver samples are full of
 * them.
 */
export function extractHeadings(source: string): DocHeading[] {
  const prose = source.replace(FENCED_CODE, "")
  const headings: DocHeading[] = []

  for (const match of prose.matchAll(/^(#{2,3})\s+(.+?)\s*$/gm)) {
    const depth = match[1].length as 2 | 3
    const { text, id } = parseHeading(match[2])
    headings.push({ id, text, depth })
  }

  return headings
}

/**
 * Prose only, for the search index.
 *
 * Code is dropped on purpose: nobody opens ⌘K to find `express.raw`, and
 * indexing samples would let one page of JavaScript outrank every real answer.
 * Values rendered by components (`<Val name="webhook.timeoutSeconds" />`) are
 * not in the index either — searching "10 seconds" will not find the timeout.
 * That is a known limit, not a bug to fix by indexing rendered output.
 */
export function stripToPlainText(source: string): string {
  return source
    .replace(FENCED_CODE, " ")
    .replace(MDX_COMMENT, " ")
    .replace(IMPORT_LINE, " ")
    .replace(EXPORT_BLOCK, " ")
    .replace(JSX_TAG, " ")
    .replace(MD_LINK, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(MD_EMPHASIS, "")
    .replace(/\s+/g, " ")
    .trim()
}

export type SearchRecord = {
  /** `/docs/webhooks#verifying-the-signature` */
  href: string
  pageTitle: string
  groupTitle: string
  /** The section heading, or the page title for the lede before the first h2. */
  heading: string
  snippet: string
  /** Lowercased haystack, precomputed so scoring does no work per keystroke. */
  haystack: string
}

const SNIPPET_LENGTH = 240

/**
 * One record per SECTION, not per page, so a result deep-links to the heading
 * that answers the question rather than dropping the reader at the top of a
 * 400-line document to scroll.
 */
export function buildSearchIndex(pages: readonly DocsPage[] = DOCS_PAGES): SearchRecord[] {
  const records: SearchRecord[] = []

  for (const page of pages) {
    const source = readDocSource(page.slug)
    const groupTitle = groupById(page.group)?.title ?? ""
    const withoutCode = source.replace(FENCED_CODE, " ")

    // Split on h2/h3 boundaries, keeping the text that follows each one. The
    // first chunk is whatever precedes the first heading — the page lede.
    const parts = withoutCode.split(/^#{2,3}\s+(.+?)\s*$/gm)
    const lede = stripToPlainText(parts[0] ?? "")

    if (lede) {
      records.push({
        href: `/docs/${page.slug}`,
        pageTitle: page.title,
        groupTitle,
        heading: page.title,
        snippet: lede.slice(0, SNIPPET_LENGTH),
        haystack: `${page.title} ${groupTitle} ${lede}`.toLowerCase(),
      })
    }

    // After the split, entries alternate: heading, body, heading, body…
    for (let i = 1; i < parts.length; i += 2) {
      const { text, id } = parseHeading(parts[i])
      const body = stripToPlainText(parts[i + 1] ?? "")
      records.push({
        href: `/docs/${page.slug}#${id}`,
        pageTitle: page.title,
        groupTitle,
        heading: text,
        snippet: body.slice(0, SNIPPET_LENGTH),
        haystack: `${text} ${page.title} ${body}`.toLowerCase(),
      })
    }
  }

  return records
}
