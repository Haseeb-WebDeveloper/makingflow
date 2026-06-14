"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { submitForm } from "@/lib/actions/submissions";
import type { PublicForm, PublicField } from "@/lib/data/public-form";
import type { AnswerValue } from "@/lib/db/schema";
import { isValidPhoneNumber } from "react-phone-number-input";
import { isFieldVisible, NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic";
import { Field, FormBranding } from "@/components/forms/field-control";
import { collectClientMeta, track } from "@/lib/forms/client-meta";

// The Lottie WASM player only appears on the post-submit success screen — code-
// split it so it never loads while the respondent is filling the form.
const Lottie = dynamic(() => import("../builder/lottie").then((m) => m.Lottie), {
  ssr: false,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+\.\S+/i;

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
  const startedRef = useRef(false);
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

    if (testMode) {
      setDone(true);
      return;
    }

    if (partialTimer.current) clearTimeout(partialTimer.current);
    setSubmitting(true);
    const payload = answerable
      .filter((f) => isFieldVisible(f.logic, values) && !isEmpty(values[f.id]))
      .map((f) => ({ fieldId: f.id, value: values[f.id]! }));

    const res = await submitForm({
      publicId: form.publicId,
      answers: payload,
      meta: collectClientMeta(),
      submissionId: submissionIdRef.current, // promote the draft if we have one
    });
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
      window.location.href = form.redirectUrl;
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <Lottie name="success" className="size-52" />
        </div>
        <h2 className="mt-4 font-sebenta text-2xl font-bold tracking-tight text-foreground">
          {form.thankYou}
        </h2>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-2xl">
      <FormBranding theme={form.theme} />
      <header className="mb-8">
        <h1 className="font-sebenta text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {form.title}
        </h1>
        {form.showProgressBar && pageCount > 1 ? (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-all"
                style={{ width: `${((idx + 1) / pageCount) * 100}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Step {idx + 1} of {pageCount}
            </p>
          </div>
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

      <div className="space-y-7">
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
      </div>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-8 flex items-center gap-3">
        {idx > 0 ? (
          <button
            type="button"
            onClick={goBack}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Back
          </button>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-11 items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
        >
          {isLast ? (submitting ? "Submitting…" : form.submitLabel) : "Next"}
        </button>
      </div>
    </form>
  );
}
