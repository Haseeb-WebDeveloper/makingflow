"use client"

import * as React from "react"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { SVGIcon } from "@/components/ui/svg-icon"
import { cn } from "@/lib/utils"

/**
 * Hand this page to an assistant.
 *
 * The premise is that a reader here is usually mid-integration with a model
 * open in another tab, and the fastest path is giving it the page rather than
 * paraphrasing it. So: copy the Markdown, open it somewhere, or — since this
 * product ships one — connect our MCP server and let the assistant read the
 * workspace directly.
 *
 * The Markdown is passed in already rendered by the server, with every live
 * value resolved. Fetching `/md` on click would be one request cheaper to
 * build and one failure mode worse: the copy would silently produce nothing
 * when offline, which is exactly when someone is reading docs on a train.
 */
export function DocsPageActions({
  markdown,
  markdownUrl,
  pageUrl,
  mcpEndpoint,
}: {
  markdown: string
  markdownUrl: string
  pageUrl: string
  mcpEndpoint: string
}) {
  const [copied, setCopied] = React.useState<"page" | "mcp" | null>(null)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy(value: string, what: "page" | "mcp") {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
    } catch {
      // Clipboard blocked — over plain HTTP, or in an embedded browser.
    }
  }

  // The assistant is asked to read the URL rather than being handed the whole
  // document: a full page of Markdown does not survive a query string, and both
  // of these can fetch.
  const prompt = `Read ${markdownUrl} and help me with it.`
  const chatgpt = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
  const claude = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

  return (
    <div className="flex shrink-0 items-center rounded-md border border-border">
      <button
        type="button"
        onClick={() => copy(markdown, "page")}
        className="flex items-center gap-1.5 rounded-l-md px-2.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon name={copied === "page" ? "tick-square" : "paper"} className="size-3.5" />
        {copied === "page" ? "Copied" : "Copy page"}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More ways to use this page"
          className={cn(
            "border-l border-border px-1.5 py-1.5 text-foreground/70 transition-colors",
            "hover:bg-muted hover:text-foreground data-open:bg-muted",
          )}
        >
          <span aria-hidden className="block text-[10px] leading-none">▾</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => copy(markdown, "page")} className="gap-2">
            <Icon name="paper" className="size-4" />
            Copy as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <a href={markdownUrl} target="_blank" rel="noreferrer">
              <Icon name="document" className="size-4" />
              View as Markdown
            </a>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild className="gap-2">
            <a href={chatgpt} target="_blank" rel="noreferrer noopener">
              <SVGIcon src="/logo/chatgpt.svg" className="size-4" />
              Open in ChatGPT
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <a href={claude} target="_blank" rel="noreferrer noopener">
              <SVGIcon src="/logo/claude.svg" preserveColors className="size-4 rounded-[3px]" />
              Open in Claude
            </a>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => copy(mcpEndpoint, "mcp")} className="gap-2">
            <SVGIcon src="/logo/mcp.svg" className="size-4" />
            {copied === "mcp" ? "MCP URL copied" : "Copy MCP server URL"}
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <Link href="/docs/mcp">
              <Icon name="plus" className="size-4" />
              Add MCP server
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Announced rather than shown: the button label changes for sighted
          users, but a screen reader needs the change spoken. */}
      <span aria-live="polite" className="sr-only">
        {copied === "page" ? "Page copied as Markdown" : copied === "mcp" ? "MCP server URL copied" : ""}
      </span>
      <span className="sr-only">{pageUrl}</span>
    </div>
  )
}
