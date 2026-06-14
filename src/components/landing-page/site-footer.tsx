import Link from "next/link"

export function SiteFooter() {
  const year = 2026
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/logo.svg" alt="" className="size-6 rounded" />
          <span className="font-sebenta text-lg font-bold tracking-tight text-foreground">
            MakingFlow
          </span>
          <span className="ml-1 text-sm text-muted-foreground">Forms that think.</span>
        </div>

        <nav className="flex items-center gap-6 text-sm">
          <Link href="#how" className="text-muted-foreground transition-colors hover:text-foreground">
            How it works
          </Link>
          <Link href="/auth/login" className="text-muted-foreground transition-colors hover:text-foreground">
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="font-medium text-foreground transition-colors hover:text-foreground/80"
          >
            Start for free
          </Link>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-5xl px-5 py-5 text-xs text-muted-foreground sm:px-8">
          &copy; {year} MakingFlow. Made for people who collect a lot of answers.
        </div>
      </div>
    </footer>
  )
}
