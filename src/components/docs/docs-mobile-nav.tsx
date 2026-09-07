"use client"

import * as React from "react"
import { DocsSidebar } from "@/components/docs/docs-sidebar"
import { Icon } from "@/components/ui/icon"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { DocsNavGroup } from "@/lib/docs/nav"

/**
 * The tree, on a phone.
 *
 * The same `DocsSidebar` in a drawer rather than a second, divergent copy —
 * this is the piece `ui/sidebar.tsx` would have given us for free, and it costs
 * about twenty lines to have without inheriting its `h-dvh` scroll contract.
 *
 * It closes on navigation. A drawer left open over the page you just asked for
 * is a small thing that feels broken every time.
 */
export function DocsMobileNav({ nav }: { nav: DocsNavGroup[] }) {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        aria-label="Open documentation menu"
      >
        <Icon name="category" className="size-4" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 overflow-y-auto thin-scroll">
        <SheetHeader>
          <SheetTitle>Documentation</SheetTitle>
          <SheetDescription className="sr-only">
            Browse the documentation sections
          </SheetDescription>
        </SheetHeader>
        <div className="px-2 pb-8">
          <DocsSidebar nav={nav} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
