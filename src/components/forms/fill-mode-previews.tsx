"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Animated wireframe mini-previews for the fill-style chooser. `AllAtOncePreview`
 * scrolls a stack of fields vertically (the whole-form feel); `OneAtATimePreview`
 * cycles a single field with an advancing progress bar (the step feel). Both are
 * decorative and hidden from assistive tech, and both go static under
 * prefers-reduced-motion. Fields are drawn as outline wireframes with muted
 * labels so the previews read as a form without competing with the real UI.
 */

type SampleField = {
  label: string;
  kind: "text" | "choice" | "yesno";
  options?: string[];
  selected?: string;
};

// Realistic, dash-free sample content so the previews read like a real form.
const SAMPLE_FIELDS: SampleField[] = [
  { label: "Full name", kind: "text" },
  { label: "Work email", kind: "text" },
  {
    label: "How did you hear about us?",
    kind: "choice",
    options: ["Search", "A friend", "Social"],
    selected: "A friend",
  },
  { label: "Company", kind: "text" },
  { label: "Enjoying this so far?", kind: "yesno", selected: "Yes" },
];

/** One field drawn as an outline wireframe: a muted label and an empty framed
 *  input, or worded outline pills for choices. */
function WireframeField({ f }: { f: SampleField }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">{f.label}</p>
      {f.kind === "text" ? (
        <div className="h-7 rounded-md border border-dashed border-foreground/25" />
      ) : (
        <div className="flex flex-wrap gap-1">
          {(f.kind === "yesno" ? ["Yes", "No"] : f.options ?? []).map((o) => (
            <span
              key={o}
              className={
                "rounded-md border px-2 py-0.5 text-[10px] " +
                (o === f.selected
                  ? "border-foreground text-foreground"
                  : "border-foreground/25 text-muted-foreground")
              }
            >
              {o}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Field rows scroll gently upward in a seamless loop (whole-form feel). */
export function AllAtOncePreview() {
  const reduce = useReducedMotion();
  const list = [...SAMPLE_FIELDS, ...SAMPLE_FIELDS];
  return (
    <div
      aria-hidden="true"
      className="h-40 overflow-hidden bg-background p-4 [mask-image:linear-gradient(to_bottom,transparent,#000_5%,#000_95%,transparent)]"
    >
      <motion.div
        className="space-y-2.5"
        animate={reduce ? undefined : { y: ["0%", "-50%"] }}
        transition={{ duration: 10, ease: "linear", repeat: Infinity }}
      >
        {list.map((f, i) => (
          <WireframeField key={i} f={f} />
        ))}
      </motion.div>
    </div>
  );
}

/** One question appears, leaves, and the next arrives while the bar advances. */
export function OneAtATimePreview() {
  const reduce = useReducedMotion();
  const seq = SAMPLE_FIELDS.slice(0, 3);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % seq.length), 1900);
    return () => clearInterval(t);
  }, [reduce, seq.length]);
  return (
    <div
      aria-hidden="true"
      className="flex h-40 flex-col justify-between bg-background p-4 rounded-md"
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className="h-full rounded-full bg-foreground/40"
          animate={{ width: `${((i + 1) / seq.length) * 100}%` }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <WireframeField f={seq[i]} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex justify-end">
        <span className="flex h-6 items-center rounded-md bg-foreground/70 px-3 text-[10px] font-medium text-background">
          Next
        </span>
      </div>
    </div>
  );
}
