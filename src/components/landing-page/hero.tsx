import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative pt-10 overflow-hidden isolate">
      {/* Sky photo sits behind the header + hero, fading into the page. */}
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[820px]">
        <Image src="/hero-sky.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,color-mix(in_oklab,var(--background)_92%,transparent)_82%,var(--background))]" />
      </div>

      <div className="mx-auto max-w-7xl px-5 pt-32 text-center sm:px-8 sm:pt-40">
        <h1 className="lp-rise mx-auto max-w-4xl font-sebenta text-4xl font-bold leading-[1.06] tracking-tight text-foreground sm:text-6xl">
          Your ultimate solution for{" "}
          <span className="text-primary">smarter forms</span>
        </h1>
        <p
          className="lp-rise mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
          style={{ animationDelay: "80ms" }}
        >
          MakingFlow turns a sentence into a form, adapts it to every
          respondent, and hands back clean, summarized answers, so you collect
          better data in less time.
        </p>

        <div
          className="lp-rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "160ms" }}
        >
          <Link
            href="#how"
            className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-background/80 px-5 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted sm:w-auto"
          >
            How it works
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto"
          >
            Start for free
          </Link>
        </div>

        {/* Product screenshot, in a window frame. */}
        <div
          className="lp-rise mx-auto mt-14 max-w-5xl"
          style={{ animationDelay: "240ms" }}
        >
          <Image
            src="/hero-dashboard.jpeg"
            alt="The MakingFlow dashboard"
            width={1200}
            height={800}
            className="w-full rounded-md"
          />
        </div>
      </div>
    </section>
  );
}
