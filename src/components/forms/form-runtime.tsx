"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { submitForm } from "@/lib/actions/submissions";
import type { PublicForm, PublicField } from "@/lib/data/public-form";
import type { AnswerValue } from "@/lib/db/schema";
import { isValidPhoneNumber } from "react-phone-number-input";
import { isFieldVisible, NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic";
import { Field, FormBranding } from "@/components/forms/field-control";
import {
  AllAtOncePreview,
  OneAtATimePreview,
} from "@/components/forms/fill-mode-previews";
import { SuccessContent } from "@/components/forms/success-content";
import { SuccessMark } from "@/components/forms/success-mark";
import { collectClientMeta, track } from "@/lib/forms/client-meta";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+\.\S+/i;

/** Focus the first interactive control inside a container — used to move focus
 *  onto each new question in step mode so keyboard/AT users land on the input
 *  and sighted users can just start typing. `preventScroll` stops the browser
 *  from scrolling the field under the fixed top progress bar. */
function focusFirstControl(container: HTMLElement | null) {
  if (!container) return;
  const el = container.querySelector<HTMLElement>(
    'input:not([type="hidden"]), textarea, select, [role="radio"], [role="slider"], button:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
  );
  el?.focus({ preventScroll: true });
}

/** A stop in one-at-a-time mode: a question (with any content blocks that
 *  introduce it), or a content-only intro/section screen bounded by page
 *  breaks. */
type Step =
  | { kind: "field"; key: string; field: PublicField; blocks: PublicField[] }
  | { kind: "content"; key: string; blocks: PublicField[] };

/** The first problem with a field's current value, or null if it's fine: covers
 *  required-but-empty and bad email/phone/url formats. */
function problemMessage(
  field: PublicField,
  value: AnswerValue | undefined
): string | null {
  if (field.required && isEmpty(value)) return "This field is required.";
  if (isEmpty(value)) return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (field.type === "email" && !EMAIL_RE.test(s))
    return "Enter a valid email address.";
  if (field.type === "phone" && !isValidPhoneNumber(s))
    return "Enter a valid phone number.";
  if (field.type === "url" && !URL_RE.test(s))
    return "Enter a valid URL (starting with http).";
  return null;
}

export function FormRuntime({
  form,
  testMode = false,
}: {
  form: PublicForm;
  /** Builder preview: validate + show the thank-you, but never record a submission. */
  testMode?: boolean;
}) {
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [resumed, setResumed] = useState(false);
  // Respondent's chosen fill style. `null` = the chooser is still showing;
  // "normal" = the paginated all-at-once view; "step" = one question at a time.
  // Locked for the session once picked (persisted so a resumed draft reopens
  // in the same style). Forms with one (or zero) answerable field skip the
  // chooser — there's nothing to step through. This guard is deterministic
  // (no browser APIs) so it's safe as the SSR/first-render initial value.
  const [fillMode, setFillMode] = useState<"normal" | "step" | null>(() =>
    form.fields.filter((f) => !NON_ANSWER_TYPES.has(f.type)).length <= 1
      ? "normal"
      : null
  );
  // In step mode, the key of the step on screen: a field id, or `c:<firstBlockId>`
  // for a content-only intro/section step.
  const [stepKey, setStepKey] = useState<string | null>(null);
  // The fill style the respondent has highlighted in the chooser (before they
  // press Continue).
  const [chooserSel, setChooserSel] = useState<"normal" | "step" | null>(null);
  const startedRef = useRef(false);
  const fillModeKey = `mf:fillmode:${form.publicId}`;

  // Micro transition applied when a new question/page appears. A short fade +
  // slight vertical slide; motion is dropped (opacity only) for respondents who
  // prefer reduced motion.
  const reduceMotion = useReducedMotion();
  const questionMotion = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduceMotion ? 0 : -6 },
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
  };
  // Wraps the current question in step mode so we can move focus into it.
  const questionRef = useRef<HTMLDivElement>(null);
  // Save & resume: the partial submission id (resume token) + a mirror of values
  // for the debounced/unload saver + the autosave debounce timer.
  const submissionIdRef = useRef<string | null>(null);
  const valuesRef = useRef<Record<string, AnswerValue>>({});
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeKey = `mf:resume:${form.publicId}`;

  const answerable = useMemo(
    () => form.fields.filter((f) => !NON_ANSWER_TYPES.has(f.type)),
    [form.fields]
  );

  // Split into pages on page_break (the break itself isn't rendered). Empty
  // pages are dropped; a form with no breaks is a single page.
  const pages = useMemo(() => {
    const result: PublicField[][] = [[]];
    for (const f of form.fields) {
      if (f.type === "page_break") result.push([]);
      else result[result.length - 1].push(f);
    }
    return result.filter((p) => p.length > 0);
  }, [form.fields]);
  const pageCount = Math.max(1, pages.length);
  const idx = Math.min(pageIndex, pageCount - 1); // clamp (form can shrink in preview)
  const currentPage = pages[idx] ?? form.fields;
  const isLast = idx >= pageCount - 1;

  // Funnel: count a view once per render of a real (non-preview) form.
  useEffect(() => {
    if (testMode) return;
    track(form.publicId, "view");
  }, [testMode, form.publicId]);

  // Restore a previously chosen fill style so a resumed draft reopens the same
  // way. localStorage isn't available during SSR, so this runs post-mount; the
  // setState is the intended one-time restore of a persisted client preference.
  useEffect(() => {
    if (testMode || fillMode !== null) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(fillModeKey);
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "normal" || saved === "step") setFillMode(saved);
  }, [testMode, fillMode, fillModeKey]);

  // ── Save & resume ─────────────────────────────────────────────────
  async function savePartialNow() {
    if (testMode) return;
    const payload = answerable
      .filter(
        (f) =>
          isFieldVisible(f.logic, valuesRef.current) &&
          !isEmpty(valuesRef.current[f.id])
      )
      .map((f) => ({ fieldId: f.id, value: valuesRef.current[f.id]! }));
    if (payload.length === 0) return;
    try {
      const res = await fetch("/api/partial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicId: form.publicId,
          submissionId: submissionIdRef.current,
          answers: payload,
        }),
        keepalive: true,
      });
      const data = await res.json().catch(() => null);
      if (data?.submissionId) {
        submissionIdRef.current = data.submissionId;
        try {
          localStorage.setItem(resumeKey, data.submissionId);
        } catch {
          /* storage blocked */
        }
      }
    } catch {
      /* best-effort */
    }
  }

  function schedulePartialSave() {
    if (testMode) return;
    if (partialTimer.current) clearTimeout(partialTimer.current);
    partialTimer.current = setTimeout(savePartialNow, 1200);
  }

  // Restore a saved draft on return; flush a final save when the tab is hidden.
  useEffect(() => {
    if (testMode) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(resumeKey);
    } catch {
      /* ignore */
    }
    if (saved) {
      submissionIdRef.current = saved;
      fetch(
        `/api/partial?publicId=${encodeURIComponent(
          form.publicId
        )}&submissionId=${encodeURIComponent(saved)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.values && Object.keys(d.values).length > 0) {
            valuesRef.current = d.values;
            setValues(d.values);
            setResumed(true);
          }
        })
        .catch(() => {});
    }
    const onHide = () => void savePartialNow();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (partialTimer.current) clearTimeout(partialTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMode, form.publicId]);

  function setValue(id: string, value: AnswerValue) {
    setValues((prev) => {
      const next = { ...prev, [id]: value };
      valuesRef.current = next;
      return next;
    });
    if (errors[id])
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    // Funnel: first interaction = a "start".
    if (!testMode && !startedRef.current) {
      startedRef.current = true;
      track(form.publicId, "start");
    }
    schedulePartialSave();
  }

  // Visible fields on a page with a problem (required-empty or bad format),
  // mapped to the message shown under each one.
  function problemsOn(fields: PublicField[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
      if (NON_ANSWER_TYPES.has(f.type) || !isFieldVisible(f.logic, values))
        continue;
      const msg = problemMessage(f, values[f.id]);
      if (msg) out[f.id] = msg;
    }
    return out;
  }

  function flagProblems(problems: Record<string, string>) {
    setErrors(problems);
    setError(null);
    const firstId = Object.keys(problems)[0];
    requestAnimationFrame(() => {
      document
        .getElementById(`field-${firstId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function goBack() {
    setError(null);
    setPageIndex(Math.max(0, idx - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // The actual submission — shared by the paginated view and the step view.
  // Callers are responsible for validating first.
  async function submitAll() {
    if (testMode) {
      setDone(true);
      return;
    }

    if (partialTimer.current) clearTimeout(partialTimer.current);
    setSubmitting(true);
    const payload = answerable
      .filter((f) => isFieldVisible(f.logic, values) && !isEmpty(values[f.id]))
      .map((f) => ({ fieldId: f.id, value: values[f.id]! }));

    // The action returns {success:false} for anything it can handle, but the
    // CALL itself rejects on transport failure — offline, dropped tunnel, an
    // edge 502, a mobile tab throttled mid-flight. Without this catch the
    // rejection escapes (error.tsx does not catch rejections from event
    // handlers), `setSubmitting(false)` never runs, and the button sits
    // disabled reading "Submitting…" forever with the answers unsent.
    let res: Awaited<ReturnType<typeof submitForm>>;
    try {
      res = await submitForm({
        publicId: form.publicId,
        answers: payload,
        meta: collectClientMeta(),
        submissionId: submissionIdRef.current, // promote the draft if we have one
      });
    } catch {
      setSubmitting(false);
      setError("We couldn't reach the server. Check your connection and try again.");
      return; // the draft and resume token survive, so Submit can be retried
    }
    setSubmitting(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    // Done — clear the resume token so a fresh visit starts clean.
    try {
      localStorage.removeItem(resumeKey);
    } catch {
      /* ignore */
    }
    submissionIdRef.current = null;
    // A redirect URL is the form's own thank-you page.
    if (form.redirectUrl) {
      window.location.assign(form.redirectUrl);
      return;
    }
    setDone(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Not the last page → validate this page, then advance.
    if (!isLast) {
      const probs = problemsOn(currentPage);
      if (Object.keys(probs).length > 0) return flagProblems(probs);
      setPageIndex(idx + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Last page → validate every page; jump to the first that has a problem.
    for (let p = 0; p < pages.length; p++) {
      const probs = problemsOn(pages[p]);
      if (Object.keys(probs).length > 0) {
        if (p !== idx) setPageIndex(p);
        return flagProblems(probs);
      }
    }

    await submitAll();
  }

  // ── One-question-at-a-time (step) mode ────────────────────────────
  /** Lock in a fill style and persist it so a resumed draft reopens the same
   *  way. Step position falls back to the first step (see `currentStep`). */
  function chooseFillMode(mode: "normal" | "step") {
    if (!testMode) {
      try {
        localStorage.setItem(fillModeKey, mode);
      } catch {
        /* storage blocked */
      }
    }
    setFillMode(mode);
  }

  /** First visible answerable field that fails validation, or null. */
  function firstProblemField(): { id: string; msg: string } | null {
    for (const f of answerable) {
      if (!isFieldVisible(f.logic, values)) continue;
      const msg = problemMessage(f, values[f.id]);
      if (msg) return { id: f.id, msg };
    }
    return null;
  }

  // Step-mode "stops". Each visible answerable field is a step, carrying the
  // content blocks (heading/text/image) that introduce it. A run of content
  // blocks bounded by a page break with no following question becomes its own
  // intro/section step. Recomputed against current answers so conditional
  // visibility is respected.
  const steps: Step[] = [];
  if (fillMode === "step") {
    let buffer: PublicField[] = [];
    for (const f of form.fields) {
      if (f.type === "page_break") {
        if (buffer.length) {
          steps.push({
            kind: "content",
            key: `c:${buffer[0].id}`,
            blocks: buffer,
          });
          buffer = [];
        }
      } else if (NON_ANSWER_TYPES.has(f.type)) {
        if (isFieldVisible(f.logic, values)) buffer.push(f);
      } else if (isFieldVisible(f.logic, values)) {
        steps.push({ kind: "field", key: f.id, field: f, blocks: buffer });
        buffer = [];
      }
    }
    if (buffer.length) {
      steps.push({ kind: "content", key: `c:${buffer[0].id}`, blocks: buffer });
    }
  }
  // Current step resolved by key; falls back to the first step so a fresh entry
  // starts at the top (the intro, if any) and an unknown key never blanks out.
  const foundStepIndex = steps.findIndex((s) => s.key === stepKey);
  const currentStepIndex = foundStepIndex === -1 ? 0 : foundStepIndex;
  const currentStep: Step | null = steps[currentStepIndex] ?? null;

  function stepBack() {
    if (currentStepIndex <= 0) return;
    setError(null);
    setErrors({});
    setStepKey(steps[currentStepIndex - 1].key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function stepNext() {
    if (!currentStep) return;
    setError(null);
    // A question step validates before moving on; a content step just advances.
    if (currentStep.kind === "field") {
      const prob = problemMessage(
        currentStep.field,
        values[currentStep.field.id]
      );
      if (prob) {
        setErrors({ [currentStep.field.id]: prob });
        return;
      }
    }
    setErrors({});

    if (currentStepIndex < steps.length - 1) {
      setStepKey(steps[currentStepIndex + 1].key);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Last step → re-validate the whole form, then submit. If something earlier
    // is invalid (e.g. a field revealed by logic), jump back to its step.
    const bad = firstProblemField();
    if (bad) {
      const badStep = steps.find(
        (s) => s.kind === "field" && s.field.id === bad.id
      );
      if (badStep) setStepKey(badStep.key);
      setErrors({ [bad.id]: bad.msg });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    await submitAll();
  }

  // Move focus onto each new question in step mode, after the enter transition
  // so the element is mounted. Keyboard/AT users land on the control instead of
  // being stranded on the Next button, and sighted users can just start typing.
  useEffect(() => {
    if (fillMode !== "step" || !currentStep) return;
    const t = setTimeout(
      () => focusFirstControl(questionRef.current),
      reduceMotion ? 0 : 230
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillMode, currentStep?.key, reduceMotion]);

  if (done) {
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-xl flex-col items-center justify-center text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <SuccessMark className="size-52" />
        </div>
        <h2 className="w-full mt-4 text-2xl font-bold tracking-tight text-foreground">
          {form.thankYou}
        </h2>
        <SuccessContent
          body={form.successBody}
          videoUrl={form.successVideoUrl}
          className="mt-6 w-full"
        />
      </div>
    );
  }

  // Fill-style chooser — a modal asked before the form (product requirement),
  // shown once for multi-question forms. It can't be dismissed without choosing.
  // Each option carries a mini-preview so the choice reads at a glance, without
  // relying on the copy.
  if (fillMode === null) {
    const allAtOnceDesc =
      pageCount > 1 ? "A few fields at a time." : "The whole form at once.";
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 md:px-4 backdrop-blur-sm">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fillmode-title"
          initial={
            reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }
          }
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-xl rounded-lg md:border border-border bg-background p-6 sm:p-8"
        >
          {form.title ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {form.title}
            </p>
          ) : null}
          <h2
            id="fillmode-title"
            className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl"
          >
            How would you like to fill this out?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Same questions either way. Pick the style you prefer.
          </p>

          {(() => {
            const options = [
              {
                mode: "normal" as const,
                title: "All at once",
                desc: allAtOnceDesc,
                preview: <AllAtOncePreview />,
              },
              {
                mode: "step" as const,
                title: "One at a time",
                desc: "One question per screen.",
                preview: <OneAtATimePreview />,
              },
            ];
            return form.chooserStyle === "list" ? (
              // Radio list rows.
              <div className="mt-7 divide-y divide-border overflow-hidden rounded-md border border-border">
                {options.map((o, i) => {
                  const selected = chooserSel === o.mode;
                  return (
                    <button
                      key={o.mode}
                      type="button"
                      autoFocus={i === 0}
                      aria-pressed={selected}
                      onClick={() => setChooserSel(o.mode)}
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
            ) : (
              // Preview cards with a radio.
              <div className="mt-7 grid gap-4 md:gap-3 sm:grid-cols-2">
                {options.map((o, i) => {
                  const selected = chooserSel === o.mode;
                  return (
                    <button
                      key={o.mode}
                      type="button"
                      autoFocus={i === 0}
                      aria-pressed={selected}
                      onClick={() => setChooserSel(o.mode)}
                      className={
                        // No padding on the card so the preview is flush/full-width;
                        // the title + description get their own padding below.
                        "group relative flex h-full flex-col overflow-hidden rounded-lg border-2 md:border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 " +
                        (selected
                          ? "border-foreground bg-muted/30"
                          : "border-border hover:border-foreground/50 hover:bg-muted/40")
                      }
                    >
                      <span className="absolute right-2 top-2 z-10">
                        <RadioDot selected={selected} />
                      </span>
                      {o.preview}
                      <div className="mt-3 px-4 pb-3">
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
            );
          })()}

          <button
            type="button"
            disabled={!chooserSel}
            onClick={() => chooserSel && chooseFillMode(chooserSel)}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 sm:w-auto"
          >
            Continue
          </button>
        </motion.div>
      </div>
    );
  }

  // One-question-at-a-time view.
  if (fillMode === "step" && currentStep) {
    const totalSteps = steps.length;
    const isLastStep = currentStepIndex >= steps.length - 1;
    const hasPrev = currentStepIndex > 0;
    const nextLabel = isLastStep
      ? submitting
        ? "Submitting…"
        : form.submitLabel
      : currentStep.kind === "content" && currentStepIndex === 0
      ? "Start"
      : "Next";

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void stepNext();
        }}
        noValidate
        className="mx-auto w-full max-w-2xl pb-28"
      >
        {/* Progress bar fixed to the top of the screen. */}
        {form.showProgressBar ? (
          <div
            className="fixed inset-x-0 top-0 z-30 h-1.5 bg-muted"
            role="progressbar"
            aria-label="Form progress"
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-valuenow={currentStepIndex + 1}
            aria-valuetext={`Step ${currentStepIndex + 1} of ${totalSteps}`}
          >
            <div
              className="h-full bg-primary transition-all rounded-full"
              style={{
                width: `${((currentStepIndex + 1) / totalSteps) * 100}%`,
              }}
            />
          </div>
        ) : null}
        <FormBranding theme={form.theme} />
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {form.title}
          </h1>
          <p className="mt-3 text-xs text-muted-foreground">
            Step {currentStepIndex + 1} of {totalSteps}
          </p>
        </header>

        {resumed ? (
          <div className="mb-6 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>We restored the answers you started earlier.</span>
            <button
              type="button"
              onClick={() => setResumed(false)}
              className="shrink-0 font-medium text-foreground hover:underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStep.key}
            ref={questionRef}
            className="space-y-8"
            initial={questionMotion.initial}
            animate={questionMotion.animate}
            exit={questionMotion.exit}
            transition={questionMotion.transition}
          >
            {currentStep.blocks.map((field) => (
              <Field
                key={field.id}
                field={field}
                value={values[field.id]}
                error={errors[field.id]}
                onChange={(v) => setValue(field.id, v)}
                testMode={testMode}
              />
            ))}
            {currentStep.kind === "field" ? (
              <Field
                key={currentStep.field.id}
                field={currentStep.field}
                value={values[currentStep.field.id]}
                error={errors[currentStep.field.id]}
                onChange={(v) => setValue(currentStep.field.id, v)}
                testMode={testMode}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>

        {error ? (
          <p role="alert" className="mt-6 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* Fixed navigation bar pinned to the bottom of the screen. */}
        <div className="fixed inset-x-0 bottom-0 z-10 bg-canvas/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3 lg:px-0">
            {hasPrev && (
              <button
                type="button"
                onClick={stepBack}
                disabled={submitting}
                className="inline-flex h-11 items-center justify-center rounded-md border border-border lg:px-8 px-5 text-base font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                Back
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-foreground px-6 lg:px-8 text-base font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60 sm:flex-none"
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    // Flex column that reaches the bottom of the screen so the nav row's
    // `mt-auto` pins it there when the content is short, and flows right after
    // the content when it's tall. `min-h` subtracts only the page's top padding
    // (py-10 top = 2.5rem); `-mb-10` cancels the page's bottom padding so the
    // row sits flush near the bottom edge (like the one-at-a-time bar), with
    // `pb-6` for breathing room.
    <form
      onSubmit={onSubmit}
      noValidate
      className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-2xl flex-col -mb-10 pb-3"
    >
      {/* Progress bar fixed to the top of the screen. */}
      {form.showProgressBar && pageCount > 1 ? (
        <div
          className="fixed inset-x-0 top-0 z-30 h-1.5 bg-muted"
          role="progressbar"
          aria-label="Form progress"
          aria-valuemin={0}
          aria-valuemax={pageCount}
          aria-valuenow={idx + 1}
          aria-valuetext={`Step ${idx + 1} of ${pageCount}`}
        >
          <div
            className="h-full bg-foreground transition-all"
            style={{ width: `${((idx + 1) / pageCount) * 100}%` }}
          />
        </div>
      ) : null}
      <FormBranding theme={form.theme} />
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {form.title}
        </h1>
        {form.showProgressBar && pageCount > 1 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Step {idx + 1} of {pageCount}
          </p>
        ) : null}
      </header>

      {resumed ? (
        <div className="mb-6 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>We restored the answers you started earlier.</span>
          <button
            type="button"
            onClick={() => setResumed(false)}
            className="shrink-0 font-medium text-foreground hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={idx}
          className="space-y-8"
          initial={questionMotion.initial}
          animate={questionMotion.animate}
          exit={questionMotion.exit}
          transition={questionMotion.transition}
        >
          {currentPage.map((field) =>
            isFieldVisible(field.logic, values) ? (
              <Field
                key={field.id}
                field={field}
                value={values[field.id]}
                error={errors[field.id]}
                onChange={(v) => setValue(field.id, v)}
                testMode={testMode}
              />
            ) : null
          )}
        </motion.div>
      </AnimatePresence>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-8">
        {idx > 0 ? (
          <button
            type="button"
            onClick={goBack}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-md border border-border px-6 lg:px-8 text-base font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Back
          </button>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-foreground px-6 lg:px-8 text-base font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60 sm:flex-none"
        >
          {isLast ? (submitting ? "Submitting…" : form.submitLabel) : "Next"}
        </button>
      </div>
    </form>
  );
}

/** Radio indicator for the chooser options. Always an opaque fill so an animated
 *  preview behind it never shows through the circle. */
function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors " +
        (selected
          ? "border-foreground bg-foreground text-background"
          : "border-muted-foreground/40 bg-background")
      }
    >
      {selected ? (
        <svg viewBox="0 0 20 20" fill="none" className="size-4">
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
