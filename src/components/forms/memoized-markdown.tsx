"use client"

import { marked } from "marked"
import { memo, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

/** Split markdown into top-level blocks so each can be memoized independently —
 * during streaming only the final, changing block re-renders. */
function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((t) => t.raw)
}

// Design-system styling for rendered markdown (no @tailwindcss/typography needed).
const COMPONENTS: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="text-sm font-semibold text-foreground">{children}</h3>,
  h2: ({ children }) => <h3 className="text-sm font-semibold text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="text-sm font-semibold text-foreground">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
  code: ({ className, children }) =>
    /language-/.test(className ?? "") ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="scrollbar-thin overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="scrollbar-thin overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-2.5 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2.5 py-1.5">{children}</td>,
}

const MarkdownBlock = memo(
  ({ content }: { content: string }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {content}
    </ReactMarkdown>
  ),
  (prev, next) => prev.content === next.content,
)
MarkdownBlock.displayName = "MarkdownBlock"

export const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content,
  id,
}: {
  content: string
  id: string
}) {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content])
  return (
    <div className="space-y-2 text-sm text-foreground">
      {blocks.map((block, i) => (
        <MarkdownBlock content={block} key={`${id}-block-${i}`} />
      ))}
    </div>
  )
})
