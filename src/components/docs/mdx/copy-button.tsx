"use client"

import * as React from "react"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * The client leaf of an otherwise fully server-rendered documentation page.
 *
 * Kept as small as it can be on purpose — everything around it, including the
 * highlighted code it copies, is static HTML. This is the only component on a
 * docs page that ships JavaScript.
 *
 * `navigator.clipboard.writeText` is inlined in six other places in this app;
 * this is the first reusable version. It swallows its own failures because the
 * clipboard is blocked outright in some embedded browsers and over plain HTTP,
 * and a thrown error in a copy button would take the page down over a
 * convenience.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard unavailable — nothing useful to say, and nothing to break.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      // Named for what it does now, so a screen reader hears the state change
      // that sighted users get from the icon swap.
      aria-label={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border",
        "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <Icon name={copied ? "tick-square" : "paper"} className="size-3.5" />
    </button>
  )
}
