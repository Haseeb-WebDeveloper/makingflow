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
  ul: ({ children }) => <ul className="list-disc space-y-1 lg:space-y-[0.278vw] pl-5 lg:pl-[1.389vw]">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 lg:space-y-[0.278vw] pl-5 lg:pl-[1.389vw]">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="text-sm lg:text-[0.972vw] font-semibold text-foreground">{children}</h3>,
  h2: ({ children }) => <h3 className="text-sm lg:text-[0.972vw] font-semibold text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="text-sm lg:text-[0.972vw] font-semibold text-foreground">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 lg:pl-[0.833vw] text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
  code: ({ className, children }) =>
    /language-/.test(className ?? "") ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded lg:rounded-[0.324vw] bg-muted px-1 lg:px-[0.278vw] py-0.5 lg:py-[0.139vw] text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="scrollbar-thin overflow-x-auto rounded-md lg:rounded-[0.556vw] border border-border bg-muted/50 p-3 lg:p-[0.833vw] text-xs lg:text-[0.833vw]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="scrollbar-thin overflow-x-auto rounded-md lg:rounded-[0.556vw] border border-border">
      <table className="w-full text-xs lg:text-[0.833vw]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-2.5 lg:px-[0.694vw] py-1.5 lg:py-[0.417vw] text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2.5 lg:px-[0.694vw] py-1.5 lg:py-[0.417vw]">{children}</td>,
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
    <div className="space-y-2 lg:space-y-[0.556vw] text-sm lg:text-[0.972vw] text-foreground">
      {blocks.map((block, i) => (
        <MarkdownBlock content={block} key={`${id}-block-${i}`} />
      ))}
    </div>
  )
})
