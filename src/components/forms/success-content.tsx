"use client"

import type { CSSProperties } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { cn } from "@/lib/utils"

/**
 * Renders the owner-authored success page shown to respondents after they
 * submit: an optional uploaded video + the body. The body is HTML (authored in
 * the builder's WYSIWYG; legacy bodies are markdown, which this still handles).
 * rehype-raw parses the stored HTML and rehype-sanitize strips anything unsafe,
 * so owner content can never inject script/unsafe HTML into a respondent's
 * browser. Inline `text-align` is whitelisted on text blocks for alignment.
 */
const SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    p: [...(defaultSchema.attributes?.p ?? []), "style"],
    h1: [...(defaultSchema.attributes?.h1 ?? []), "style"],
    h2: [...(defaultSchema.attributes?.h2 ?? []), "style"],
    h3: [...(defaultSchema.attributes?.h3 ?? []), "style"],
  },
}

/** Map an authored text-align onto a tailwind class (other inline CSS is ignored). */
function alignClass(style?: CSSProperties): string {
  switch (style?.textAlign) {
    case "center":
      return "text-center"
    case "right":
      return "text-right"
    case "justify":
      return "text-justify"
    default:
      return ""
  }
}

const COMPONENTS: Components = {
  p: ({ children, style }) => <p className={cn("leading-relaxed", alignClass(style))}>{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children, style }) => (
    <h2 className={cn("text-xl font-bold tracking-tight text-foreground", alignClass(style))}>{children}</h2>
  ),
  h2: ({ children, style }) => (
    <h3 className={cn("text-lg font-bold tracking-tight text-foreground", alignClass(style))}>{children}</h3>
  ),
  h3: ({ children, style }) => (
    <h4 className={cn("text-base font-semibold text-foreground", alignClass(style))}>{children}</h4>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-left">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-left">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-left text-muted-foreground">
      {children}
    </blockquote>
  ),
  // `title="icon"` (set by the builder's "Icon" button) renders small + inline,
  // so a few sit side by side on one line; anything else is a full-width block.
  img: ({ src, alt, title }) =>
    typeof src === "string" ? (
      title === "icon" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ""} className="mx-1 my-1 inline-block h-12 w-auto rounded-md align-middle" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ""} className="mx-auto my-3 max-h-80 w-auto rounded-lg" />
      )
    ) : null,
  hr: () => <hr className="border-border" />,
}

export function SuccessContent({
  body,
  videoUrl,
  className,
}: {
  body?: string | null
  videoUrl?: string | null
  className?: string
}) {
  if (!body && !videoUrl) return null
  return (
    <div className={className}>
      {videoUrl ? (
        <video
          src={videoUrl}
          controls
          playsInline
          className="mx-auto mb-5 w-full max-w-md rounded-xl border border-border"
        />
      ) : null}
      {body ? (
        <div className="mx-auto w-full space-y-3 text-left text-base text-muted-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
            components={COMPONENTS}
          >
            {body}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  )
}
