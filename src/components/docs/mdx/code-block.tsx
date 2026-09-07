import { CopyButton } from "@/components/docs/mdx/copy-button"
import { highlight } from "@/lib/docs/highlighter"
import { cn } from "@/lib/utils"

/**
 * Every code sample in the documentation, from either direction.
 *
 * TWO CALLERS, ONE COMPONENT. MDX fenced blocks reach it through the `pre`
 * entry in the component map; live samples that interpolate policy constants
 * reach it directly as `<CodeBlock source={NODE_RECEIVER} lang="ts" />`. That
 * matters because the samples carrying the signature algorithm are the ones a
 * reader most needs highlighted, and they can never be fenced blocks — MDX
 * treats a fence as literal, so `${TIMESTAMP_TOLERANCE_SECONDS}` inside one
 * would publish those characters instead of the number.
 *
 * A server component with no async work: `highlight` is synchronous, so this
 * prerenders into static HTML and stays renderable by `renderToStaticMarkup`
 * in the tests that assert what the samples say.
 */
export function CodeBlock({
  source,
  lang,
  filename,
  copy = true,
}: {
  source: string
  lang?: string
  /** Shown in the header strip — "server.ts", "verify.py". */
  filename?: string
  copy?: boolean
}) {
  const code = source.replace(/\n$/, "")
  const highlighted = highlight(code, lang)
  const showHeader = Boolean(filename) || copy

  return (
    <figure className="not-prose my-4 overflow-hidden rounded-lg border border-border bg-muted/40">
      {showHeader ? (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <figcaption className="truncate font-mono text-xs text-muted-foreground">
            {filename ?? lang ?? ""}
          </figcaption>
          {copy ? <CopyButton value={code} label="Copy code" /> : null}
        </div>
      ) : null}

      {highlighted ? (
        // Shiki emits its own <pre>, with the light theme inline and the dark
        // one as --shiki-dark custom properties that globals.css swaps under
        // .dark. One render serves both themes with no flash on toggle.
        <div
          className="thin-scroll overflow-x-auto p-4 text-[0.8125rem] leading-6 [&_pre]:bg-transparent!"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        // No grammar for this language. Plain and readable beats a build error.
        <pre
          className={cn(
            "thin-scroll overflow-x-auto p-4 text-[0.8125rem] leading-6 text-foreground",
          )}
        >
          <code>{code}</code>
        </pre>
      )}
    </figure>
  )
}
