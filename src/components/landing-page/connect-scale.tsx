import { Reveal } from "./reveal";
import { Eyebrow } from "./eyebrow";
import Image from "next/image";

const LEFT = ["/logo/google-sheet.svg", "/logo/webhook.svg"];
const RIGHT = ["/logo/email.svg", "/logo/discord.svg"];

export function ConnectScale() {
  return (
    <section
      id="integration"
      className="scroll-mt-20 bg-background px-5 py-10 sm:px-8"
    >
      <div className="mx-auto max-w-7xl rounded-xl bg-[linear-gradient(180deg,color-mix(in_oklab,var(--primary)_5%,var(--background)),var(--accent))] px-6 py-16 text-center sm:px-12 sm:py-20">
        <Reveal className="mx-auto max-w-2xl">
          <Eyebrow>Integration</Eyebrow>
          <h2 className="mt-4 font-sebenta text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem]">
            Connect, automate, and scale.
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
            MakingFlow connects to the tools you already use, so every response
            flows straight into your workflow.
          </p>
        </Reveal>

        {/* Node diagram: apps on either side of the MakingFlow hub. */}
        <Reveal delay={120}>
          <div className="mx-auto mt-12 flex max-w-2xl items-center justify-center gap-2 sm:gap-4">
            {LEFT.map((src) => (
              <Node key={src} src={src} />
            ))}
            <Wire />
            <span className="grid size-16 shrink-0 place-items-center rounded-xl border border-primary/20 bg-background ring-2 ring-primary/10">
              <Image
                src="/logo/logo.svg"
                alt="MakingFlow"
                width={200}
                height={200}
                className="size-8"
              />
            </span>
            <Wire />
            {RIGHT.map((src) => (
              <Node key={src} src={src} />
            ))}
          </div>
        </Reveal>

        {/* Testimonial */}
        <Reveal delay={180}>
          <figure className="mx-auto mt-14 max-w-xl">
            <blockquote className="font-sebenta text-xl font-medium leading-relaxed text-foreground sm:text-2xl">
              “MakingFlow changed how we collect answers. It connects everything
              — responses just show up where we already work.”
            </blockquote>
            <figcaption className="mt-5 flex items-center justify-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                JD
              </span>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">
                  John Drove
                </p>
                <p className="text-xs text-muted-foreground">CEO, Greenfield</p>
              </div>
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

function Node({ src }: { src: string }) {
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-background sm:size-14">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-6" />
    </span>
  );
}

function Wire() {
  return (
    <span className="h-px w-6 shrink-0 bg-[repeating-linear-gradient(90deg,var(--border)_0_4px,transparent_4px_8px)] sm:w-10" />
  );
}
