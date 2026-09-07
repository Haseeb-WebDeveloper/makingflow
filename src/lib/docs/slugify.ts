/**
 * Heading text → anchor id.
 *
 * Pure and client-safe on purpose: THREE things need to agree on what a heading
 * is called — the `id` the heading component renders, the `href` the table of
 * contents links to, and the deep-link the search index emits. If any two of
 * them disagreed the symptom is a link that scrolls nowhere, which nobody
 * notices until a reader reports it. One function, imported by all three.
 *
 * This is also why there is no `rehype-slug` in the build. A plugin would give
 * ids to the rendered HTML only, leaving the TOC and the search index to
 * re-derive them by a second rule that would drift.
 */

/**
 * Docus-style explicit id: `## What we send [#payload]`.
 *
 * Needed because the webhooks page already publishes `#payload`, `#verify` and
 * `#retries`, and slugifying those titles produces different strings. An anchor
 * that has been shared in a support reply must keep working, so the author can
 * pin one rather than accept whatever the title happens to generate.
 */
const EXPLICIT_ID = /\s*\[#([a-z0-9-]+)\]\s*$/i

export type ParsedHeading = {
  /** The title with any `[#id]` suffix removed. */
  text: string
  id: string
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // Strip anything that is not a letter, digit, space or hyphen. Done before
    // the space→hyphen step so "don't" collapses to "dont" rather than "don-t".
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Split a heading into its display text and its anchor id. */
export function parseHeading(raw: string): ParsedHeading {
  const explicit = raw.match(EXPLICIT_ID)
  if (explicit) {
    return { text: raw.replace(EXPLICIT_ID, "").trim(), id: explicit[1].toLowerCase() }
  }
  const text = raw.trim()
  return { text, id: slugify(text) }
}

/**
 * Flatten a React heading's children to plain text so it can be slugified.
 *
 * Headings in MDX arrive as arrays mixing strings with elements — `## The
 * `raw` body` is a string, an inline-code element, then another string. Reading
 * only the first child would silently truncate the id.
 */
export function headingText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(headingText).join("")
  if (typeof node === "object" && "props" in node) {
    return headingText((node.props as { children?: React.ReactNode }).children)
  }
  return ""
}
