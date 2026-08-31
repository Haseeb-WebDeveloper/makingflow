"use client";

import { useState } from "react";
import {
  AllAtOncePreview,
  OneAtATimePreview,
} from "@/components/forms/fill-mode-previews";

/**
 * /sandbox/chooser — dev-only gallery of fill-style chooser designs for the team
 * to review and pick one. Version A is what's live today; B–E are alternatives.
 * Not linked from anywhere.
 */

type Mode = "normal" | "step";

const OPTIONS: { key: Mode; title: string; desc: string }[] = [
  { key: "normal", title: "All at once", desc: "The whole form on one page." },
  { key: "step", title: "One at a time", desc: "One question per screen." },
];

const PREVIEW: Record<Mode, React.ReactNode> = {
  normal: <AllAtOncePreview />,
  step: <OneAtATimePreview />,
};

export default function ChooserSandbox() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Fill-style chooser — versions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick one for the “How would you like to fill this out?” step. Each is
          interactive — try selecting.
        </p>
      </header>

      <div className="space-y-12">
        <Version
          name="Version A — Preview cards"
          note="Live today. Click a card to choose immediately (no confirm step)."
        >
          <VariantPreviewCards />
        </Version>

        <Version
          name="Version B — Radio cards"
          note="Circle at the top-right of each card marks it as a selectable option; a Continue button confirms."
        >
          <VariantRadioCards />
        </Version>

        <Version
          name="Version C — Radio list"
          note="Compact stacked rows with a leading radio. Good when space is tight / no previews."
        >
          <VariantRadioList />
        </Version>

        <Version
          name="Version D — Preview + Continue (no radio)"
          note="Version A’s previews; selecting a card highlights it and a Continue button confirms."
        >
          <VariantPreview radio={false} withContinue={true} />
        </Version>

        <Version
          name="Version E — Preview + radio, no Continue"
          note="Previews with a radio at the top-right; clicking a card chooses immediately."
        >
          <VariantPreview radio={true} withContinue={false} />
        </Version>

        <Version
          name="Version F — Preview + radio + Continue"
          note="Previews with a radio and an explicit Continue button (select, then confirm)."
        >
          <VariantPreview radio={true} withContinue={true} />
        </Version>

        <Version
          name="Version G — Segmented toggle"
          note="A two-way switch; the preview and description update to the active choice."
        >
          <VariantSegmented />
        </Version>
      </div>
    </div>
  );
}

// ── Scaffolding ──────────────────────────────────────────────────────────────

function Version({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{name}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      </div>
      <Modal>{children}</Modal>
    </section>
  );
}

/** The shared dialog frame + heading, so variants differ only in the options. */
function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-6 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        MakingFlow Field Explorer
      </p>
      <h3 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        How would you like to fill this out?
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Same questions either way. Pick the style you prefer.
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Small confirmation line shown after a variant "starts". */
function Chosen({ mode }: { mode: Mode | null }) {
  if (!mode) return null;
  const label = OPTIONS.find((o) => o.key === mode)?.title;
  return (
    <p className="mt-4 text-xs text-muted-foreground">
      → would start in <span className="font-medium text-foreground">{label}</span> mode
    </p>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        // Always an opaque fill so an animated preview behind it never shows
        // through the circle.
        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors " +
        (selected
          ? "border-foreground bg-foreground text-background"
          : "border-muted-foreground/40 bg-background")
      }
    >
      {selected ? (
        <svg viewBox="0 0 20 20" fill="none" className="size-3">
          <path
            d="M5 10.5l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function Continue({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 sm:w-auto"
    >
      Continue
    </button>
  );
}

// ── Version A: preview cards (click to choose) ───────────────────────────────

function VariantPreviewCards() {
  const [chosen, setChosen] = useState<Mode | null>(null);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setChosen(o.key)}
            className="group flex flex-col rounded-xl border border-border p-2 text-left outline-none transition-colors hover:border-foreground/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {PREVIEW[o.key]}
            <div className="mt-3 px-1 pb-1">
              <span className="block font-semibold text-foreground">
                {o.title}
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {o.desc}
              </span>
            </div>
          </button>
        ))}
      </div>
      <Chosen mode={chosen} />
    </div>
  );
}

// ── Version B: radio cards (circle top-right) + Continue ─────────────────────

function VariantRadioCards() {
  const [sel, setSel] = useState<Mode | null>(null);
  const [chosen, setChosen] = useState<Mode | null>(null);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const selected = sel === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setSel(o.key)}
              className={
                "relative rounded-xl border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 " +
                (selected
                  ? "border-foreground bg-muted/40"
                  : "border-border hover:border-foreground/40 hover:bg-muted/20")
              }
            >
              <span className="absolute right-3 top-3">
                <RadioDot selected={selected} />
              </span>
              <span className="block pr-7 font-semibold text-foreground">
                {o.title}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {o.desc}
              </span>
            </button>
          );
        })}
      </div>
      <Continue disabled={!sel} onClick={() => sel && setChosen(sel)} />
      <Chosen mode={chosen} />
    </div>
  );
}

// ── Version C: radio list rows + Continue ────────────────────────────────────

function VariantRadioList() {
  const [sel, setSel] = useState<Mode | null>(null);
  const [chosen, setChosen] = useState<Mode | null>(null);
  return (
    <div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {OPTIONS.map((o) => {
          const selected = sel === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setSel(o.key)}
              className={
                "flex w-full items-center gap-3 p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 " +
                (selected ? "bg-muted/40" : "hover:bg-muted/20")
              }
            >
              <RadioDot selected={selected} />
              <span>
                <span className="block font-medium text-foreground">
                  {o.title}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {o.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <Continue disabled={!sel} onClick={() => sel && setChosen(sel)} />
      <Chosen mode={chosen} />
    </div>
  );
}

// ── Preview-card family: preview cards with optional radio + optional Continue ─
// - radio=false, withContinue=true  → Version D (select highlights, confirm)
// - radio=true,  withContinue=false → Version E (click chooses immediately)
// - radio=true,  withContinue=true  → Version F (select then confirm)

function VariantPreview({
  radio,
  withContinue,
}: {
  radio: boolean;
  withContinue: boolean;
}) {
  const [sel, setSel] = useState<Mode | null>(null);
  const [chosen, setChosen] = useState<Mode | null>(null);
  const pick = (m: Mode) => {
    setSel(m);
    if (!withContinue) setChosen(m); // no confirm step → choose on click
  };
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const selected = sel === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={selected}
              onClick={() => pick(o.key)}
              className={
                "relative flex flex-col rounded-xl border p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 " +
                (selected
                  ? "border-foreground bg-muted/30"
                  : "border-border hover:border-foreground/40 hover:bg-muted/20")
              }
            >
              {radio ? (
                <span className="absolute right-3 top-3 z-10">
                  <RadioDot selected={selected} />
                </span>
              ) : null}
              {PREVIEW[o.key]}
              <div className="mt-3 px-1 pb-1">
                <span className="block font-semibold text-foreground">
                  {o.title}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {o.desc}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {withContinue ? (
        <Continue disabled={!sel} onClick={() => sel && setChosen(sel)} />
      ) : null}
      <Chosen mode={chosen} />
    </div>
  );
}

// ── Version E: segmented toggle + live preview ───────────────────────────────

function VariantSegmented() {
  const [sel, setSel] = useState<Mode>("normal");
  const [chosen, setChosen] = useState<Mode | null>(null);
  const active = OPTIONS.find((o) => o.key === sel)!;
  return (
    <div>
      <div className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto">
        {OPTIONS.map((o) => {
          const selected = sel === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setSel(o.key)}
              className={
                "flex-1 rounded-md px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex-none " +
                (selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {o.title}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-border p-2">
        {PREVIEW[sel]}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{active.desc}</p>

      <Continue disabled={false} onClick={() => setChosen(sel)} />
      <Chosen mode={chosen} />
    </div>
  );
}
