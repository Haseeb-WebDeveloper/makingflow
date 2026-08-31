import Link from "next/link"
import { Reveal } from "./reveal"

export function FinalCta() {
  return (
    <section className="relative overflow-hidden ">
      <div aria-hidden className="absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hero-sky.jpg" alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_55%,transparent),color-mix(in_oklab,var(--background)_25%,transparent))]" />
      </div>

      <div className="mx-auto max-w-7xl px-5 py-24 text-center sm:px-8 sm:py-32">
        <Reveal className="mx-auto max-w-xl">
          <h2 className="text-[2.5rem] font-bold leading-[1.15] text-foreground sm:text-[50px]">
            Make flow with makingflow
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted-foreground sm:text-base">
            Describe your first form in one sentence. Build it, share the link, and watch the
            answers come back already read.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto"
            >
              Try MakingFlow now
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
