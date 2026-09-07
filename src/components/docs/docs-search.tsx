"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Kbd } from "@/components/ui/kbd"
import { scoreDocs } from "@/lib/docs/search"
import type { SearchRecord } from "@/lib/docs/source"

/**
 * ⌘K over the documentation.
 *
 * The index is built at prerender from the MDX sources and handed down from the
 * layout, so it lives in the RSC payload the router already fetched — no
 * request, no service, no dependency beyond the `cmdk` dialog the app ships
 * anyway. Two pages of prose come to a few kilobytes; if it ever passes ~50 KB,
 * move it behind a prerendered route handler fetched on first open, which
 * changes nothing else here.
 *
 * `shouldFilter={false}` because cmdk's scorer is built for short labels — form
 * titles, page names — and our values are whole sections. Given a paragraph it
 * treats a passing mention the same as the section actually about the topic.
 * `scoreDocs` weights the heading over the page title over the body instead.
 */
const SearchContext = React.createContext<{ open: () => void } | null>(null)

export function useDocsSearch() {
  const context = React.useContext(SearchContext)
  if (!context) throw new Error("useDocsSearch must be used inside <DocsSearchProvider>")
  return context
}

export function DocsSearchProvider({
  index,
  children,
}: {
  index: SearchRecord[]
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const router = useRouter()

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((previous) => !previous)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const results = React.useMemo(() => scoreDocs(index, query), [index, query])

  // With no query, show every page's lede rather than an empty box — the
  // dialog doubles as a table of contents for the whole site.
  const shown = query.trim()
    ? results
    : index.filter((record) => !record.href.includes("#")).slice(0, 8)

  const value = React.useMemo(() => ({ open: () => setOpen(true) }), [])

  function go(href: string) {
    setOpen(false)
    setQuery("")
    router.push(href)
  }

  return (
    <SearchContext.Provider value={value}>
      {children}

      {/* Composed from Dialog + Command rather than using `CommandDialog`,
          which renders its `Command` with no props and so cannot be told to
          stop filtering. `ui/` is not ours to edit, and re-filtering an
          already-ranked list would drop correct results. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search documentation</DialogTitle>
          <DialogDescription>Find a page or a section</DialogDescription>
        </DialogHeader>
        <DialogContent
          className="max-w-lg overflow-hidden rounded-lg! p-0 lg:rounded-lg! lg:p-0"
          showCloseButton={false}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search the docs…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>Nothing matched “{query}”.</CommandEmpty>
              <CommandGroup heading={query.trim() ? "Results" : "Pages"}>
                {shown.map((record) => (
                  <CommandItem
                    key={record.href}
                    value={record.href}
                    onSelect={() => go(record.href)}
                    className="flex items-start gap-2.5"
                  >
                    <Icon name="document" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{record.heading}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {record.pageTitle} · {record.groupTitle}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>

            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd>
                Open
              </span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </SearchContext.Provider>
  )
}
