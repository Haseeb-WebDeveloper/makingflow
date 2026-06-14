import Link from "next/link"

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden">
      {/* A whisper of brand light behind the headline, nothing loud. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] lg:h-[29.167vw] bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_8%,transparent),transparent)]"
      />

      <div className="mx-auto max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] pt-20 lg:pt-[5.556vw] text-center sm:px-8 sm:pt-28">
        <span className="lp-rise inline-flex items-center gap-2 lg:gap-[0.556vw] rounded-full border border-border bg-background px-3 lg:px-[0.833vw] py-1 lg:py-[0.278vw] text-xs lg:text-[0.833vw] font-medium tracking-wide text-muted-foreground">
          <span className="size-1.5 lg:size-[0.417vw] rounded-full bg-primary" />
          AI form builder
        </span>

        <h1
          className="lp-rise mx-auto mt-6 lg:mt-[1.667vw] max-w-3xl lg:max-w-[53.333vw] font-sebenta text-[2.75rem] lg:text-[3.056vw] font-bold leading-[1.04] tracking-tight text-foreground sm:text-7xl"
          style={{ animationDelay: "60ms" }}
        >
          Build forms that think.
        </h1>

        <p
          className="lp-rise mx-auto mt-6 lg:mt-[1.667vw] max-w-xl lg:max-w-[40vw] text-pretty text-base lg:text-[1.111vw] leading-relaxed text-muted-foreground sm:text-lg"
          style={{ animationDelay: "140ms" }}
        >
          Tell MakingFlow what you need in plain words. It builds the form,
          adapts it to each person who fills it out, and hands back clean answers
          you can actually use.
        </p>

        <div
          className="lp-rise mx-auto mt-9 lg:mt-[2.5vw] flex w-full flex-col items-center gap-3 lg:gap-[0.833vw] sm:w-auto sm:flex-row sm:justify-center"
          style={{ animationDelay: "220ms" }}
        >
          <Link
            href="/auth/signup"
            className="inline-flex h-11 lg:h-[3.056vw] w-full items-center justify-center rounded-md lg:rounded-[0.556vw] bg-foreground px-6 lg:px-[1.667vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90 sm:w-auto"
          >
            Start for free
          </Link>
          <Link
            href="#how"
            className="inline-flex h-11 lg:h-[3.056vw] w-full items-center justify-center rounded-md lg:rounded-[0.556vw] border border-border px-6 lg:px-[1.667vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
          >
            See how it works
          </Link>
        </div>

        <p
          className="lp-rise mt-4 lg:mt-[1.111vw] text-xs lg:text-[0.833vw] text-muted-foreground"
          style={{ animationDelay: "300ms" }}
        >
          No credit card. Your first forms are on us.
        </p>
      </div>

      {/* Real product: the builder, mid-thought. */}
      <div className="mx-auto mt-14 lg:mt-[3.889vw] max-w-5xl lg:max-w-[71.111vw] px-5 lg:px-[1.389vw] pb-20 lg:pb-[5.556vw] sm:px-8 sm:pb-28">
        <div
          className="lp-rise overflow-hidden rounded-xl lg:rounded-[0.926vw] border border-border bg-background shadow-lg"
          style={{ animationDelay: "360ms" }}
        >
          <BuilderTopBar />
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
            <ChatPanel />
            <FormCanvas />
          </div>
        </div>
      </div>
    </section>
  )
}

function BuilderTopBar() {
  return (
    <div className="flex items-center gap-2 lg:gap-[0.556vw] border-b border-border bg-muted/40 px-4 lg:px-[1.111vw] py-2.5 lg:py-[0.694vw]">
      <span className="size-2.5 lg:size-[0.694vw] rounded-full bg-border" />
      <span className="size-2.5 lg:size-[0.694vw] rounded-full bg-border" />
      <span className="size-2.5 lg:size-[0.694vw] rounded-full bg-border" />
      <span className="ml-3 lg:ml-[0.833vw] truncate font-sebenta text-sm lg:text-[0.972vw] font-semibold text-foreground">
        Employee feedback
      </span>
      <span className="ml-auto inline-flex items-center gap-1 lg:gap-[0.278vw] rounded-full bg-success/10 px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium text-success">
        <span className="size-1.5 lg:size-[0.417vw] rounded-full bg-success" />
        Saved
      </span>
    </div>
  )
}

function ChatPanel() {
  return (
    <div className="flex flex-col gap-4 lg:gap-[1.111vw] border-b border-border p-4 lg:p-[1.111vw] lg:border-b-0 lg:border-r">
      <div className="flex items-start gap-2.5 lg:gap-[0.694vw]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/logo.svg" alt="" className="mt-0.5 lg:mt-[0.139vw] size-6 lg:size-[1.667vw] shrink-0 rounded-md lg:rounded-[0.556vw]" />
        <p className="text-sm lg:text-[0.972vw] leading-relaxed text-muted-foreground">
          Built your feedback form. It is anonymous and takes under a minute. Ask
          for any changes.
        </p>
      </div>

      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl lg:rounded-[1.111vw] rounded-br-md lg:rounded-br-[0.556vw] bg-foreground px-3.5 lg:px-[0.972vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-background">
          Create a form for employee feedback
        </p>
      </div>

      <div className="mt-auto rounded-xl lg:rounded-[0.926vw] border border-border bg-background p-2.5 lg:p-[0.694vw]">
        <p className="px-1 lg:px-[0.278vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-muted-foreground">
          Make the first question required
        </p>
        <div className="flex justify-end">
          <span className="grid size-8 lg:size-[2.222vw] place-items-center rounded-lg lg:rounded-[0.694vw] bg-foreground text-background">
            <svg viewBox="0 0 24 24" className="size-4 lg:size-[1.111vw]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  )
}

function FormCanvas() {
  return (
    <div className="bg-canvas px-6 lg:px-[1.667vw] py-8 lg:py-[2.222vw] sm:px-10">
      <div className="mx-auto max-w-md lg:max-w-[31.111vw] space-y-7 lg:space-y-[1.944vw]">
        <h2 className="font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground">
          How are things going?
        </h2>

        <Field delay={520} label="How happy are you at work right now?">
          <div className="flex gap-1.5 lg:gap-[0.417vw]">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={
                  "grid size-9 lg:size-[2.5vw] place-items-center rounded-md lg:rounded-[0.556vw] border text-sm lg:text-[0.972vw] " +
                  (n === 4
                    ? "border-foreground bg-foreground text-background"
                    : "border-input text-muted-foreground")
                }
              >
                {n}
              </span>
            ))}
          </div>
        </Field>

        <Field delay={640} label="What is working well?">
          <div className="h-16 lg:h-[4.444vw] rounded-md lg:rounded-[0.556vw] border border-input bg-background" />
        </Field>

        <Field delay={760} label="What would you change?">
          <div className="h-16 lg:h-[4.444vw] rounded-md lg:rounded-[0.556vw] border border-input bg-background" />
        </Field>

        <Field delay={880} label="Would you recommend us as a place to work?">
          <div className="flex gap-2 lg:gap-[0.556vw]">
            <span className="rounded-md lg:rounded-[0.556vw] border border-input px-4 lg:px-[1.111vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-foreground">
              Yes
            </span>
            <span className="rounded-md lg:rounded-[0.556vw] border border-input px-4 lg:px-[1.111vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] text-muted-foreground">
              No
            </span>
          </div>
        </Field>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  delay,
}: {
  label: string
  children: React.ReactNode
  delay: number
}) {
  return (
    <div className="lp-rise space-y-2 lg:space-y-[0.556vw]" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-sm lg:text-[0.972vw] font-medium text-foreground">{label}</p>
      {children}
    </div>
  )
}
