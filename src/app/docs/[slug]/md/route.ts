import { docMarkdown } from "@/lib/docs/markdown"
import { DOCS_PAGES } from "@/lib/docs/pages"

/**
 * The page as Markdown, at `/docs/<slug>/md`.
 *
 * Backs "View as Markdown" and gives an assistant a URL it can fetch directly —
 * which matters for a product whose own documentation is largely about
 * connecting assistants. A reader debugging a webhook receiver in ChatGPT
 * should be able to paste one link instead of describing the signing scheme
 * from memory.
 *
 * `text/plain` rather than `text/markdown`, deliberately: browsers download an
 * unknown type instead of showing it, and the point of this URL is that a
 * person can open it and read it.
 */
export function generateStaticParams() {
  return DOCS_PAGES.map((page) => ({ slug: page.slug }))
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const markdown = docMarkdown(slug)

  if (!markdown) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })
  }

  return new Response(markdown, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  })
}
