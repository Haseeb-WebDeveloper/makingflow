import Link from "next/link"
import { Reveal } from "./reveal"

export function ClosingCta() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-sebenta text-[2.5rem] font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Describe your first form.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            It takes one sentence and about a minute. Build it, share the link,
            and watch the answers come back already read.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto"
            >
              Start for free
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Free to start. No credit card.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
