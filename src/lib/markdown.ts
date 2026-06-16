import { Marked } from "marked"
import TurndownService from "turndown"

/**
 * Owner-authored rich text (e.g. the form success page) is STORED as markdown so
 * the public runtime keeps rendering it with react-markdown + sanitize, and so
 * nothing new ships to the respondent bundle. The builder edits it in a WYSIWYG
 * (Tiptap) editor, which speaks HTML — so we convert markdown <-> HTML only at
 * the editor boundary. Both directions run client-side (in the builder).
 */

// breaks:false matches the public runtime (react-markdown + remark-gfm), where a
// single newline is whitespace, not a <br> — so the editor renders legacy content
// the same way respondents already see it. A real line break is Shift+Enter.
const marked = new Marked({ gfm: true, breaks: false })

/** Markdown -> HTML, for loading stored content into the WYSIWYG editor. */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return ""
  // Sync: we don't enable marked's async option, so parse returns a string.
  return marked.parse(markdown) as string
}

let turndown: TurndownService | null = null
function turndownService(): TurndownService {
  if (turndown) return turndown
  turndown = new TurndownService({
    headingStyle: "atx", // "## Heading", matching what the old toolbar produced
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined",
  })
  return turndown
}

/** HTML -> Markdown, for saving the WYSIWYG editor's content back as markdown. */
export function htmlToMarkdown(html: string): string {
  if (!html) return ""
  return turndownService().turndown(html).trim()
}
