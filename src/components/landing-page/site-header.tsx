"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

// Only link to anchors that actually exist on the page. Features/Pricing/etc.
// pages don't exist yet, so they're left out rather than shipped broken.
const LINKS = [{ name: "How it works", href: "#how" }]

export function SiteHeader({ isAuthed = false }: { isAuthed?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 lg:h-[4.444vw] max-w-6xl lg:max-w-[80vw] items-center justify-between px-5 lg:px-[1.389vw] sm:px-8">
        {/* Wordmark */}
        <Link
          href="/"
          className="font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground"
          aria-label="MakingFlow home"
        >
          MakingFlow
        </Link>

        {/* Desktop nav — active/hover by color only, no underlines or pills */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-9 lg:gap-[2.5vw] md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm lg:text-[0.972vw] text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.name}
            </Link>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-1 lg:gap-[0.278vw] md:flex">
          {isAuthed ? (
            <Link
              href="/forms"
              className="rounded-md lg:rounded-[0.556vw] bg-foreground px-4 lg:px-[1.111vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="rounded-md lg:rounded-[0.556vw] px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/auth/signup"
                className="rounded-md lg:rounded-[0.556vw] bg-foreground px-4 lg:px-[1.111vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
              >
                Start for free
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
          className="-mr-2 lg:-mr-[0.556vw] inline-flex h-10 lg:h-[2.778vw] w-10 lg:w-[2.778vw] items-center justify-center text-foreground md:hidden"
        >
          <span className="relative block h-4 lg:h-[1.111vw] w-5 lg:w-[1.389vw]">
            <span
              className={cn(
                "absolute left-0 block h-0.5 lg:h-[0.139vw] w-5 lg:w-[1.389vw] bg-foreground transition-all duration-300",
                open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-1/2 block h-0.5 lg:h-[0.139vw] w-5 lg:w-[1.389vw] -translate-y-1/2 bg-foreground transition-opacity duration-300",
                open ? "opacity-0" : "opacity-100",
              )}
            />
            <span
              className={cn(
                "absolute left-0 block h-0.5 lg:h-[0.139vw] w-5 lg:w-[1.389vw] bg-foreground transition-all duration-300",
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
          open ? "max-h-80 lg:max-h-[22.222vw]" : "max-h-0",
        )}
      >
        <nav className="flex flex-col gap-1 lg:gap-[0.278vw] border-t border-border px-5 lg:px-[1.389vw] py-4 lg:py-[1.111vw]">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-md lg:rounded-[0.556vw] px-2 lg:px-[0.556vw] py-2.5 lg:py-[0.694vw] text-sm lg:text-[0.972vw] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.name}
            </Link>
          ))}
          <div className="mt-2 lg:mt-[0.556vw] flex flex-col gap-2 lg:gap-[0.556vw] border-t border-border pt-3 lg:pt-[0.833vw]">
            {isAuthed ? (
              <Link
                href="/forms"
                onClick={() => setOpen(false)}
                className="rounded-md lg:rounded-[0.556vw] bg-foreground px-4 lg:px-[1.111vw] py-2.5 lg:py-[0.694vw] text-center text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  onClick={() => setOpen(false)}
                  className="rounded-md lg:rounded-[0.556vw] px-2 lg:px-[0.556vw] py-2.5 lg:py-[0.694vw] text-sm lg:text-[0.972vw] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/signup"
                  onClick={() => setOpen(false)}
                  className="rounded-md lg:rounded-[0.556vw] bg-foreground px-4 lg:px-[1.111vw] py-2.5 lg:py-[0.694vw] text-center text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
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
