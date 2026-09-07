import type { MDXComponents } from "mdx/types"
import Link from "next/link"
import { Callout } from "@/components/docs/mdx/callout"
import { CodeBlock } from "@/components/docs/mdx/code-block"
import {
  DocRow,
  DocTable,
  DocTableBody,
  DocTableHead,
  Td,
  Th,
} from "@/components/docs/mdx/doc-table"
import { Step, Steps } from "@/components/docs/mdx/steps"
import { Val } from "@/components/docs/mdx/val"
import {
  McpClientGuides,
  McpEndpoint,
  McpEndpointInline,
  McpPermissionsTable,
  McpToolTable,
} from "@/components/docs/live/mcp"
import {
  WebhookHeadersTable,
  WebhookPayloadSample,
  WebhookReceiver,
  WebhookRetryTable,
} from "@/components/docs/live/webhooks"
import { headingText, parseHeading } from "@/lib/docs/slugify"
import { cn } from "@/lib/utils"

/**
 * How a `.mdx` file becomes a page.
 *
 * TWO HALVES. The element map styles ordinary markdown against the design
 * system — there is no `@tailwindcss/typography` in this app, and
 * `memoized-markdown.tsx` records that as a decision rather than an oversight.
 * The component map makes a set of components AMBIENT: anything registered here
 * can be used in any document with no import line, which is what makes
 * "editable without writing React" true rather than aspirational.
 *
 * Headings compute their own ids here rather than through `rehype-slug`,
 * because Turbopack can only take plugins as string names with serializable
 * options — and because the table of contents and the search index derive the
 * same ids from the same function, so a link can never point at an anchor that
 * does not exist.
 */

/** Repeated ×12 across the old pages, in three subtly different forms. Once. */
function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  )
}

/**
 * `## What we send [#payload]` → an `<h2 id="payload">What we send</h2>`.
 *
 * The explicit-id suffix exists so the anchors the webhooks page already
 * publishes — `#payload`, `#verify`, `#retries` — survive the migration.
 * Slugifying those titles would produce different strings, silently breaking
 * every link anyone has shared to them.
 */
function heading(level: 2 | 3 | 4) {
  const Tag = `h${level}` as const

  return function Heading({ children }: { children?: React.ReactNode }) {
    const { text, id } = parseHeading(headingText(children))
    const size =
      level === 2 ? "text-lg font-semibold" : level === 3 ? "text-base font-semibold" : "text-sm font-semibold"

    return (
      // scroll-mt clears the sticky header, so a deep link does not land with
      // its own heading hidden behind the chrome.
      <Tag id={id} className={cn("scroll-mt-20 text-foreground", size, level === 2 ? "mt-10 mb-3" : "mt-6 mb-2")}>
        <a href={`#${id}`} className="group inline-flex items-center gap-2 no-underline">
          {text}
          <span
            aria-hidden
            className="text-border opacity-0 transition-opacity group-hover:opacity-100"
          >
            #
          </span>
        </a>
      </Tag>
    )
  }
}

/**
 * Fenced code blocks arrive as `<pre><code class="language-ts">…</code></pre>`,
 * so the language and the raw text both have to be dug out of the child before
 * they can be handed to the one component that renders code.
 */
function Pre({ children }: { children?: React.ReactNode }) {
  const child = children as
    | { props?: { className?: string; children?: unknown } }
    | undefined
  const className = child?.props?.className ?? ""
  const lang = /language-([\w-]+)/.exec(className)?.[1]
  const source = typeof child?.props?.children === "string" ? child.props.children : ""

  return <CodeBlock source={source} lang={lang} />
}

const components: MDXComponents = {
  h1: ({ children }) => (
    <h1 className="mt-0 mb-3 text-2xl font-semibold tracking-tight text-foreground">{children}</h1>
  ),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),

  p: ({ children }) => <p className="mt-3 text-[0.9375rem] leading-7 text-foreground/90">{children}</p>,
  ul: ({ children }) => (
    <ul className="mt-3 ml-4 list-disc space-y-2 text-[0.9375rem] leading-7 text-foreground/90 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 ml-4 list-decimal space-y-2 text-[0.9375rem] leading-7 text-foreground/90 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,

  strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  a: ({ href, children }) => {
    const external = href?.startsWith("http")
    const className =
      "text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"

    if (external) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
          {children}
        </a>
      )
    }
    return (
      <Link href={href ?? "#"} className={className}>
        {children}
      </Link>
    )
  },

  code: InlineCode,
  pre: Pre,

  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border pl-4 text-[0.9375rem] leading-7 text-foreground/80 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-border" />,

  // Markdown tables get the same treatment as the component ones, so a doc can
  // use whichever reads better in source without the output diverging.
  table: ({ children }) => <DocTable>{children}</DocTable>,
  thead: ({ children }) => <DocTableHead>{children}</DocTableHead>,
  tbody: ({ children }) => <DocTableBody>{children}</DocTableBody>,
  tr: ({ children }) => <DocRow>{children}</DocRow>,
  th: ({ children }) => <Th>{children}</Th>,
  td: ({ children }) => <Td>{children}</Td>,

  // ── Ambient components: usable in any .mdx with no import ──
  Callout,
  CodeBlock,
  Steps,
  Step,
  Val,
  DocTable,
  DocTableHead,
  DocTableBody,
  DocRow,
  Th,
  Td,

  // ── Live values: each reads the module that owns the fact ──
  WebhookRetryTable,
  WebhookHeadersTable,
  WebhookPayloadSample,
  WebhookReceiver,
  McpEndpoint,
  McpEndpointInline,
  McpClientGuides,
  McpPermissionsTable,
  McpToolTable,
}

/** Next 16 calls this with NO arguments — older signatures took `components`. */
export function useMDXComponents(): MDXComponents {
  return components
}
