/**
 * Inline-only markdown normalization.
 *
 * Deliberately dependency-free (no `marked`, no `turndown`) so the respondent
 * runtime can import it without pulling a markdown toolchain into that bundle —
 * which is why it lives here rather than in `@/lib/markdown`.
 *
 * WHY IT EXISTS
 *
 * Question text and heading blocks are authored as markdown, but they are a
 * single line of prose: the editor offers bold/italic/link and nothing else,
 * and the renderer (INLINE_MD in field-control) maps only `p`/`strong`/`em`/`a`.
 * Markdown's BLOCK constructs have no place there, and letting the parser see
 * them destroys text rather than formatting it:
 *
 *   "1. Full Name"      -> <ol><li>Full Name</li></ol>   — the "1." is GONE
 *   "- tools used"      -> <ul><li>tools used</li></ul>  — the "-" is GONE
 *   "\t1.\tFigmenta"    -> <pre><code>                   — an indented code block
 *
 * That matters because every label written before questions became rich text is
 * plain text that is now about to be parsed as markdown — and numbered
 * questions ("1. Full Name", "2. Email Address") are one of the most common
 * things a form author writes. Rendering them as list items would silently
 * renumber every question on the form to "1.".
 *
 * So: strip leading indentation (it collapses on render anyway) and escape any
 * leading marker that would open a block, leaving inline marks untouched. The
 * result round-trips — turndown re-escapes the same way — and
 * `markdownToPlainText` drops the backslashes again.
 */

/** Line starts that open a markdown block, each with the offset to escape. */
function blockEscapeOffset(line: string): number | null {
  // Ordered list: "1. x" / "12) x" — escape the delimiter, keeping the number.
  const ordered = /^(\d{1,9})[.)](\s|$)/.exec(line)
  if (ordered) return ordered[1].length

  // Setext underline ("===" / "---" under a line) and thematic breaks.
  if (/^[-=]+\s*$/.test(line)) return 0
  if (/^(\*{3,}|_{3,})\s*$/.test(line)) return 0

  // ATX heading, blockquote, bullet list, fenced code.
  if (/^#{1,6}(\s|$)/.test(line)) return 0
  if (/^>/.test(line)) return 0
  if (/^[-+*](\s|$)/.test(line)) return 0
  if (/^(`{3,}|~{3,})/.test(line)) return 0

  return null
}

/**
 * Escape anything that looks like an HTML tag, wherever it sits on the line.
 *
 * The editor never emits raw HTML, so a tag in a stored label is always legacy
 * text someone typed — and plain React, which is what rendered these before,
 * showed it literally. Left unescaped it becomes inline HTML that the
 * sanitizer then deletes, so "Age <b> 18" would silently lose "<b>". The
 * lookbehind keeps this idempotent.
 */
function escapeTagStarts(line: string): string {
  return line.replace(/(?<!\\)<(?=[a-zA-Z!/?])/g, "\\<")
}

/**
 * Normalize stored text to markdown that can only ever produce INLINE content.
 * A no-op for ordinary prose; idempotent, because an already-escaped marker no
 * longer matches the patterns above.
 */
export function toInlineMarkdown(src: string): string {
  if (!src) return ""
  return src
    .split(/\r?\n/)
    .map((raw) => {
      // Leading whitespace renders as nothing on a single line, and four spaces
      // (or a tab) would otherwise open an indented code block.
      const line = escapeTagStarts(raw.replace(/^[ \t]+/, ""))
      const at = blockEscapeOffset(line)
      return at === null ? line : `${line.slice(0, at)}\\${line.slice(at)}`
    })
    .join("\n")
}
