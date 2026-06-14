import Link from "next/link"

export function SiteFooter() {
  const year = 2026
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto flex max-w-5xl lg:max-w-[71.111vw] flex-col gap-6 lg:gap-[1.667vw] px-5 lg:px-[1.389vw] py-10 lg:py-[2.778vw] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-2.5 lg:gap-[0.694vw]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/logo.svg" alt="" className="size-6 lg:size-[1.667vw] rounded lg:rounded-[0.324vw]" />
          <span className="font-sebenta text-lg lg:text-[1.25vw] font-bold tracking-tight text-foreground">
            MakingFlow
          </span>
          <span className="ml-1 lg:ml-[0.278vw] text-sm lg:text-[0.972vw] text-muted-foreground">Forms that think.</span>
        </div>

        <nav className="flex items-center gap-6 lg:gap-[1.667vw] text-sm lg:text-[0.972vw]">
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
        <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-5 lg:py-[1.389vw] text-xs lg:text-[0.833vw] text-muted-foreground sm:px-8">
          &copy; {year} MakingFlow. Made for people who collect a lot of answers.
        </div>
      </div>
    </footer>
  )
}
