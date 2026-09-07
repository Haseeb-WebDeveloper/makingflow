/**
 * Ranking for the ⌘K dialog.
 *
 * Pure and client-safe: it runs on every keystroke in the browser, over an
 * index the server built at prerender.
 *
 * WHY NOT cmdk's BUILT-IN FILTER. `CommandDialog` scores against each item's
 * `value` string, which works well for the short labels it was designed for —
 * form titles, page names. Our values are whole sections of prose, and its
 * scorer treats a match on any word anywhere as roughly equal, so a passing
 * mention outranks the section actually about the topic. Hence
 * `shouldFilter={false}` at the call site and this instead.
 */

import type { SearchRecord } from "@/lib/docs/source"

export type ScoredRecord = SearchRecord & { score: number }

/** Heading hits beat title hits beat body hits. */
const HEADING_HIT = 12
const PAGE_TITLE_HIT = 5
const BODY_HIT = 1
/** All the words, adjacent and in order — much stronger evidence than any sum. */
const PHRASE_BONUS = 25
/** The reader is most likely still typing the last word. */
const PREFIX_HIT = 3

export function scoreDocs(
  index: readonly SearchRecord[],
  query: string,
  limit = 8,
): ScoredRecord[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []

  const tokens = trimmed.split(/\s+/).filter(Boolean)

  const scored: ScoredRecord[] = []

  for (const record of index) {
    // EVERY token must appear somewhere. Requiring all of them is what stops a
    // two-word query returning everything that matched only the common word.
    if (!tokens.every((token) => record.haystack.includes(token))) continue

    const heading = record.heading.toLowerCase()
    const pageTitle = record.pageTitle.toLowerCase()

    let score = 0
    for (const token of tokens) {
      if (heading.includes(token)) score += HEADING_HIT
      if (pageTitle.includes(token)) score += PAGE_TITLE_HIT
      if (record.haystack.includes(token)) score += BODY_HIT
      if (heading.startsWith(token)) score += PREFIX_HIT
    }
    if (record.haystack.includes(trimmed)) score += PHRASE_BONUS

    scored.push({ ...record, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.heading.localeCompare(b.heading))
    .slice(0, limit)
}
