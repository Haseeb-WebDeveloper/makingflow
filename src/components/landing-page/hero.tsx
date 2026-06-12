import Link from "next/link"

export function Hero() {
  return (
    <section className="relative w-full">
      <div className="mx-auto flex max-w-3xl flex-col items-center px-5 py-24 text-center sm:px-8 sm:py-32">
        {/* Eyebrow — thin outline, no fill, no shadow */}
        <span className="mb-7 inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground">
          AI form builder
        </span>

        <h1 className="font-sebenta text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
          Build forms that think.
        </h1>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Describe what you need in plain language and MakingFlow builds it. Your
          forms adapt to every respondent, in their own language — then hand you
          clean answers, neatly summarized.
        </p>

        <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/auth/signup"
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto"
          >
            Start for free
          </Link>
          <Link
            href="#features"
            className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
          >
            See how it works
          </Link>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          No credit card required.
        </p>
      </div>
    </section>
  )
}
