import Link from "next/link"
import { Reveal } from "./reveal"

export function ClosingCta() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] py-24 lg:py-[6.667vw] sm:px-8 sm:py-32">
        <Reveal className="mx-auto max-w-2xl lg:max-w-[46.667vw] text-center">
          <h2 className="font-sebenta text-[2.5rem] lg:text-[2.778vw] font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Describe your first form.
          </h2>
          <p className="mx-auto mt-5 lg:mt-[1.389vw] max-w-md lg:max-w-[31.111vw] text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground sm:text-lg">
            It takes one sentence and about a minute. Build it, share the link,
            and watch the answers come back already read.
          </p>
          <div className="mt-9 lg:mt-[2.5vw] flex flex-col items-center justify-center gap-3 lg:gap-[0.833vw] sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex h-11 lg:h-[3.056vw] w-full items-center justify-center rounded-md lg:rounded-[0.556vw] bg-foreground px-6 lg:px-[1.667vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto"
            >
              Start for free
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex h-11 lg:h-[3.056vw] w-full items-center justify-center rounded-md lg:rounded-[0.556vw] border border-border px-6 lg:px-[1.667vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-4 lg:mt-[1.111vw] text-xs lg:text-[0.833vw] text-muted-foreground">
            Free to start. No credit card.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
