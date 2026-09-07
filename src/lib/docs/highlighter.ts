import "server-only"

import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import bash from "shiki/langs/bash.mjs"
import javascript from "shiki/langs/javascript.mjs"
import json from "shiki/langs/json.mjs"
import python from "shiki/langs/python.mjs"
import typescript from "shiki/langs/typescript.mjs"
import githubDark from "shiki/themes/github-dark.mjs"
import githubLight from "shiki/themes/github-light.mjs"

/**
 * Syntax highlighting, synchronously.
 *
 * SYNC IS THE WHOLE POINT, and it is not a micro-optimisation. Two things
 * depend on it:
 *
 *   - the docs routes prerender to static HTML, and sync work completes during
 *     prerender with no `"use cache"` and no dynamic hole;
 *   - the documentation tests render components with `renderToStaticMarkup`,
 *     which cannot await. An async highlighter would mean the code samples —
 *     the part of the webhook docs most worth testing, because they carry the
 *     signature algorithm — could no longer be asserted on.
 *
 * `createHighlighterCoreSync` needs its grammars and themes as plain objects
 * rather than as loaders, hence the explicit imports. Only the five languages
 * the docs actually use are bundled; pulling the full bundle would ship every
 * grammar Shiki knows to build a page with four code blocks. The JavaScript
 * regex engine replaces Oniguruma, so there is no WebAssembly to load.
 *
 * The `.mjs` suffixes are required: Shiki's export map forwards `./*` verbatim
 * and does no extension resolution, so `shiki/langs/typescript` does not
 * resolve while `shiki/langs/typescript.mjs` does.
 */

export const DOCS_LANGUAGES = ["typescript", "javascript", "python", "bash", "json"] as const
export type DocsLanguage = (typeof DOCS_LANGUAGES)[number]

export const LIGHT_THEME = "github-light"
export const DARK_THEME = "github-dark"

/**
 * Module scope, so the grammars are parsed once per process rather than once
 * per code block. Init measured ~450ms; per-block highlighting is trivial after
 * that, and all of it happens at build.
 */
let highlighter: HighlighterCore | null = null

function getHighlighter(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    themes: [githubLight, githubDark],
    langs: [typescript, javascript, python, bash, json],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighter
}

/** Map the languages authors actually write to the grammars we loaded. */
const ALIASES: Record<string, DocsLanguage> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  json: "json",
  http: "bash",
}

export function resolveLanguage(lang: string | undefined): DocsLanguage | null {
  if (!lang) return null
  return ALIASES[lang.toLowerCase()] ?? null
}

/**
 * Highlighted HTML, or null when we have no grammar for the language.
 *
 * Returning null rather than throwing is deliberate: an unknown language in a
 * doc should render as plain, readable code, not fail the build. The caller
 * falls back to an escaped `<pre>`.
 *
 * Emits both themes in one pass — light as real colours, dark as `--shiki-dark`
 * custom properties that a CSS rule swaps in under `.dark`. One render, no
 * duplicated markup, and no flash when the theme toggles.
 */
/**
 * Run `fn` with a stopped clock.
 *
 * `@shikijs/vscode-textmate` takes `Date.now()` at the top of its tokenizer
 * loop to enforce a time limit, and reads it again on each iteration. Under
 * `cacheComponents` that is a build failure — "used `Date.now()` before
 * accessing either uncached data or Request data" — because a prerender must be
 * deterministic, and a clock read is the definition of not being. The time
 * limit cannot be switched off either: passing `timeLimit: 0` skips the
 * comparison but not the initial read.
 *
 * Freezing the clock gives the tokenizer a constant, so elapsed time is always
 * zero and the limit never trips — which is the behaviour we want at build time
 * anyway, where there is no user waiting to be protected from a pathological
 * grammar. And it keeps highlighting SYNCHRONOUS, which is what lets these
 * pages prerender and lets the documentation tests render code samples at all.
 *
 * Scoped to a single synchronous call and restored in a `finally`, so nothing
 * can observe the frozen clock: no await point exists inside for other work to
 * interleave through.
 */
function withFrozenClock<T>(fn: () => T): T {
  const realNow = Date.now
  Date.now = FROZEN_NOW
  try {
    return fn()
  } finally {
    Date.now = realNow
  }
}

const FROZEN_NOW = () => 0

export function highlight(code: string, lang: string | undefined): string | null {
  const resolved = resolveLanguage(lang)
  if (!resolved) return null

  return withFrozenClock(() =>
    getHighlighter().codeToHtml(code, {
      lang: resolved,
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
      defaultColor: "light",
    }),
  )
}
