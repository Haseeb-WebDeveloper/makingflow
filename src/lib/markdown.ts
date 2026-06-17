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

/**
 * Runs of 2+ regular spaces collapse to one in markdown/HTML, so the deliberate
 * gaps an author types (e.g. spreading a row of social icons apart) would be
 * lost. Convert each such run to the same number of non-breaking spaces, which
 * survive the markdown round-trip and don't collapse when rendered. A single
 * space is left alone so normal prose still wraps. Walks text nodes only, so it
 * never touches tag/attribute markup.
 */
export function preserveSpacing(html: string): string {
  if (typeof document === "undefined") return html // client-only path; no-op on server
  const doc = new DOMParser().parseFromString(html, "text/html")
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue
    if (text && /  +/.test(text)) {
      node.nodeValue = text.replace(/ {2,}/g, (run) => " ".repeat(run.length))
    }
  }
  return doc.body.innerHTML
}

/** HTML -> Markdown, for saving the WYSIWYG editor's content back as markdown. */
export function htmlToMarkdown(html: string): string {
  if (!html) return ""
  return turndownService().turndown(preserveSpacing(html)).trim()
}

/**
 * Heuristic: does this string already look like HTML (vs. legacy markdown)? Used
 * by the HTML-storage editors to load a body that may have been saved in the old
 * markdown format before the switch — see the success page. A markdown body
 * almost never contains an HTML element tag.
 */
export function looksLikeHtml(s: string): boolean {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(s)
}

/** Normalize a stored body to HTML for an HTML-native editor (converts legacy markdown). */
export function toEditorHtml(value: string): string {
  if (!value) return ""
  return looksLikeHtml(value) ? value : markdownToHtml(value)
}
