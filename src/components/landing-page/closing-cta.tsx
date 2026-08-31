import Link from "next/link"
import { Reveal } from "./reveal"

export function ClosingCta() {
  return (
    <section className="bg-background px-5 pb-16 pt-4 sm:px-8 sm:pb-20">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-xl bg-primary px-6 py-20 text-center sm:px-8 sm:py-28">
        {/* lime + deep-blue light so the panel reads rich, not flat */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-16 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--secondary)_45%,transparent),transparent)] blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -right-10 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,#ffffff_22%,transparent),transparent)] blur-2xl"
        />

        <Reveal className="relative mx-auto max-w-3xl">
          <h2 className="text-[2.5rem] font-bold leading-[1.05] tracking-tight text-primary-foreground sm:text-6xl">
            Describe your first form.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-primary-foreground/80 sm:text-lg">
            It takes one sentence and about a minute. Build it, share the link,
            and watch the answers come back already read.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-secondary px-6 text-sm font-semibold text-secondary-foreground transition-transform hover:scale-[1.02] sm:w-auto"
            >
              Start for free
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-primary-foreground/25 bg-primary-foreground/5 px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10 sm:w-auto"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-primary-foreground/70">
            Free to start. No credit card.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
