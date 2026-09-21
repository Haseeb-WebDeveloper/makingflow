import { Marked } from "marked"
import TurndownService from "turndown"

import { toInlineMarkdown } from "@/lib/markdown-inline"
export { toInlineMarkdown }

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

// Named entities marked emits when escaping text, plus nbsp (preserveSpacing
// introduces those). Numeric references are handled separately below.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match
  })
}

/**
 * Markdown -> bare words, for every consumer that needs the TEXT of authored
 * content rather than its formatting: CSV headers, the `answers.question`
 * snapshot, Sheets/Notion column names, AI prompts, validation messages, and
 * builder chrome (logic editor, analytics cards). Without it those surfaces
 * would print literal `**asterisks**` the moment someone bolds a question.
 *
 * Goes via HTML rather than pattern-matching the markdown, which is what makes
 * it safe to strip tags with a regex: marked escapes any `<` in the source to
 * `&lt;`, so every remaining angle bracket is a real tag. Block ends and `<br>`
 * become a space so "One\n\nTwo" reads as "One Two" instead of "OneTwo", then
 * whitespace collapses — these consumers are all single-line.
 *
 * Server-safe: no DOM, unlike `preserveSpacing`.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return ""
  // Inline-normalize FIRST. Without it "1. Full Name" parses as a list item and
  // the number — the part a CSV header most needs — is thrown away.
  const text = markdownToHtml(toInlineMarkdown(markdown))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|blockquote|div|tr|td|th)>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
  return decodeEntities(text).replace(/\s+/g, " ").trim()
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
