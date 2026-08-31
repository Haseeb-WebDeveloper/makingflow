"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { SVGIcon } from "../ui/svg-icon"

// Anchors map to real sections on the landing page.
const LINKS = [
  { name: "Features", href: "#features" },
  { name: "How it works", href: "#how" },
  { name: "Pricing", href: "#pricing" },
  { name: "Integration", href: "#integration" },
]

export function SiteHeader({ isAuthed = false }: { isAuthed?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <header className="absolute top-0 z-50 w-full">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Wordmark */}
        <Link
          href="/"
          className="flex items-center gap-1 text-xl font-bold tracking-tight text-foreground"
          aria-label="MakingFlow home"
        >
          <SVGIcon
            src="/logo/logo.svg"
            preserveColors
            className="size-6 rounded"
          />
          MakingFlow
        </Link>

        {/* Desktop nav — active/hover by color only, no underlines or pills */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-9 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm"
            >
              {link.name}
            </Link>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-1 md:flex">
          {isAuthed ? (
            <Link
              href="/forms"
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/auth/signup"
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
              >
                Try it for free
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger → X */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
          className="-mr-2 inline-flex h-10 w-10 items-center justify-center text-foreground md:hidden"
        >
          <span className="relative block h-4 w-5">
            <span
              className={cn(
                "absolute left-0 block h-0.5 w-5 bg-foreground transition-all duration-300",
                open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-1/2 block h-0.5 w-5 -translate-y-1/2 bg-foreground transition-opacity duration-300",
                open ? "opacity-0" : "opacity-100",
              )}
            />
            <span
              className={cn(
                "absolute left-0 block h-0.5 w-5 bg-foreground transition-all duration-300",
                open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0",
              )}
            />
          </span>
        </button>
      </div>

      {/* Mobile menu — clips closed via max-height, border lives on the panel */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height] duration-300 ease-out md:hidden",
          open ? "max-h-80" : "max-h-0",
        )}
      >
        <nav className="flex flex-col gap-1 border-t border-border px-5 py-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.name}
            </Link>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            {isAuthed ? (
              <Link
                href="/forms"
                onClick={() => setOpen(false)}
                className="rounded-md bg-foreground px-4 py-2.5 text-center text-sm font-medium text-background transition-colors hover:bg-foreground/90"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/signup"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-foreground px-4 py-2.5 text-center text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  Start for free
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}
