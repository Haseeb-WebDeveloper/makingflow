"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Loading } from "@/components/ui/loading";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  importTallyForm,
  importTallyFormFromApiKey,
  importTallySubmissions,
  listTallyApiForms,
  type ImportApiResult,
  type ImportFormResult,
  type ListTallyFormsResult,
} from "@/lib/actions/import-tally";

/** A CSV bigger than this is a data migration, not a form move. */
const MAX_CSV_BYTES = 5_000_000;

type Imported = Extract<ImportFormResult, { success: true }>;
// Derived rather than imported: the type lives in a `server-only` module, and
// reaching for it through the action's result keeps this file unable to pull
// server code into the browser bundle even by accident.
type TallyForm = Extract<ListTallyFormsResult, { success: true }>["forms"][number];
type Outcome = { id: string; name: string; result: ImportApiResult };

type Mode = "link" | "key";

/**
 * Move forms over from Tally.
 *
 * Two ways in, because migrating users arrive holding different things.
 *
 * SHARE LINK works for anyone — a public Tally form page carries its own
 * definition, so no account and no key are needed. Responses come separately,
 * from the CSV export, because the page has the questions but never the answers.
 *
 * API KEY does the whole account at once, reaches private and unpublished
 * forms, and brings the responses without the CSV round-trip. It also matches
 * answers to questions by identity rather than by header text, so a question
 * renamed after its responses were collected still lands in the right place.
 */
export function ImportTallyDialog({
  trigger,
  className,
}: {
  trigger?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("link");
  // Bumped on every open so both panels remount with fresh state — nothing from
  // a previous import, least of all an API key, survives closing the dialog.
  const [session, setSession] = React.useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSession((n) => n + 1);
          setMode("link");
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className={cn("gap-1.5", className)}>
            <Icon name="download" className="size-4" />
            Import from Tally
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Tally</DialogTitle>
          <DialogDescription>
            {mode === "link"
              ? "Paste the share link to your Tally form. We'll rebuild its questions here — no Tally account needed."
              : "Connect with a Tally API key to bring over several forms at once, including private ones, with their responses."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <ModeTab active={mode === "link"} onClick={() => setMode("link")}>
            Share link
          </ModeTab>
          <ModeTab active={mode === "key"} onClick={() => setMode("key")}>
            API key
          </ModeTab>
        </div>

        {mode === "link" ? (
          <LinkImport key={`link-${session}`} onClose={() => setOpen(false)} />
        ) : (
          <KeyImport key={`key-${session}`} onClose={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ── Share link ──────────────────────────────────────────────────────────────

/**
 * The public-page path, in two steps the user can stop between.
 *
 * The form is created and kept the moment step one succeeds, so closing the
 * dialog here loses nothing.
 */
function LinkImport({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [imported, setImported] = React.useState<Imported | null>(null);
  const [responses, setResponses] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await importTallyForm(url);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setImported(result);
    // The form exists from here on, so the list behind the dialog is stale.
    router.refresh();
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again after an error
    if (!file || !imported) return;
    if (file.size > MAX_CSV_BYTES) {
      setError("That file is over 5 MB. Split the export and import it in parts.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await importTallySubmissions(imported.formId, await file.text());
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    const parts = [`${result.imported} response${result.imported === 1 ? "" : "s"} imported`];
    if (result.duplicates > 0) parts.push(`${result.duplicates} already here`);
    if (result.truncated > 0) parts.push(`${result.truncated} left for a second run`);
    if (result.emptyRows > 0) parts.push(`${result.emptyRows} empty`);
    setResponses(parts.join(" · "));
    if (result.unmatched.length > 0) {
      showToast(
        `Couldn't place ${result.unmatched.length} column${
          result.unmatched.length === 1 ? "" : "s"
        }: ${result.unmatched.slice(0, 3).join(", ")}`,
        { type: "info", duration: 10000 },
      );
    }
    router.refresh();
  }

  if (!imported) {
    return (
      <form onSubmit={onImport} className="space-y-3">
        <Input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tally.so/r/abc123"
          aria-label="Tally form link"
          disabled={busy}
        />
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <DialogFooter>
          <Button type="submit" disabled={!url.trim() || busy}>
            {busy ? <Loading fill className="size-4" /> : null}
            {busy ? "Reading the form…" : "Import form"}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Icon name="tick-square" className="size-4 text-success" />
          {imported.title}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {imported.fieldCount} question{imported.fieldCount === 1 ? "" : "s"} imported
          {responses ? ` · ${responses}` : ""}
        </p>
        <SkippedNote skipped={imported.skipped} />
      </div>

      <div>
        <p className="text-sm font-medium text-foreground">Responses (optional)</p>
        <p className="mt-1 text-xs text-muted-foreground">
          In Tally, open this form&apos;s Submissions tab and click Download CSV. Importing the
          same file twice is safe — we skip what&apos;s already here.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={onUpload}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 gap-1.5"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loading fill className="size-4" /> : <Icon name="upload" className="size-4" />}
          {responses ? "Import another CSV" : "Choose CSV"}
        </Button>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Done
        </Button>
        <Button
          onClick={() => router.push(`/forms/${imported.formId}/edit`)}
          disabled={busy}
        >
          Open form
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── API key ─────────────────────────────────────────────────────────────────

/**
 * The API-key path: connect, choose forms, import them one at a time.
 *
 * Sequential on purpose. Tally allows 100 requests a minute and a form costs
 * several, so firing every selected form at once would rate-limit a large
 * migration halfway through — and one-at-a-time is also what makes the progress
 * line honest rather than a spinner that means nothing.
 */
function KeyImport({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [apiKey, setApiKey] = React.useState("");
  const [forms, setForms] = React.useState<TallyForm[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [withResponses, setWithResponses] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number; name: string } | null>(null);
  const [outcomes, setOutcomes] = React.useState<Outcome[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await listTallyApiForms(apiKey);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.forms.length === 0) {
      setError("That key works, but the account has no forms in it.");
      return;
    }
    setForms(result.forms);
    setSelected(new Set(result.forms.map((f) => f.id)));
  }

  async function onImport() {
    const chosen = (forms ?? []).filter((f) => selected.has(f.id));
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const done: Outcome[] = [];

    for (const [index, form] of chosen.entries()) {
      setProgress({ done: index, total: chosen.length, name: form.name });
      const result = await importTallyFormFromApiKey(apiKey, form.id, withResponses);
      done.push({ id: form.id, name: form.name, result });
      // Show each one as it lands rather than making a long migration look stuck.
      setOutcomes([...done]);
    }

    setProgress(null);
    setBusy(false);
    router.refresh();
  }

  // Step 1 — the key.
  if (!forms) {
    return (
      <form onSubmit={onConnect} className="space-y-3">
        <Input
          autoFocus
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="tly-••••••••••••••••"
          aria-label="Tally API key"
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          Find it in Tally under Settings → API keys. We use it for this import and never store
          it. Tally keys give full access to the account they belong to, so revoke it in Tally
          once you&apos;re done.
        </p>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <DialogFooter>
          <Button type="submit" disabled={!apiKey.trim() || busy}>
            {busy ? <Loading fill className="size-4" /> : null}
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  // Step 3 — results.
  if (outcomes && !busy) {
    const ok = outcomes.filter((o) => o.result.success);
    const totalResponses = ok.reduce(
      (sum, o) => sum + (o.result.success ? o.result.imported : 0),
      0,
    );
    return (
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          Imported {ok.length} of {outcomes.length} form{outcomes.length === 1 ? "" : "s"}
          {totalResponses > 0 ? ` and ${totalResponses} responses` : ""}.
        </p>
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {outcomes.map((o) => (
            <li key={o.id} className="rounded-lg border border-border p-3">
              <OutcomeRow outcome={o} />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  // Step 2 — choose, and the running progress.
  const chosenCount = selected.size;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          {forms.length} form{forms.length === 1 ? "" : "s"} found
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setSelected(
              chosenCount === forms.length ? new Set() : new Set(forms.map((f) => f.id)),
            )
          }
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {chosenCount === forms.length ? "Clear all" : "Select all"}
        </button>
      </div>

      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {forms.map((form) => (
          <li key={form.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.has(form.id)}
                disabled={busy}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(form.id);
                  else next.delete(form.id);
                  setSelected(next);
                }}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{form.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {form.submissionCount} response{form.submissionCount === 1 ? "" : "s"}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={withResponses}
          disabled={busy}
          onChange={(e) => setWithResponses(e.target.checked)}
        />
        Bring their responses across too
      </label>

      {progress ? (
        <p className="text-xs text-muted-foreground">
          Importing {progress.done + 1} of {progress.total} — {progress.name}
        </p>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onImport} disabled={chosenCount === 0 || busy}>
          {busy ? <Loading fill className="size-4" /> : null}
          {busy ? "Importing…" : `Import ${chosenCount} form${chosenCount === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}

function OutcomeRow({ outcome }: { outcome: Outcome }) {
  const { result, name } = outcome;

  if (!result.success) {
    return (
      <>
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Icon name="danger-circle" className="size-4 text-destructive" />
          {name}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{result.error}</p>
      </>
    );
  }

  const parts = [`${result.fieldCount} question${result.fieldCount === 1 ? "" : "s"}`];
  if (result.imported > 0) parts.push(`${result.imported} responses`);
  if (result.duplicates > 0) parts.push(`${result.duplicates} already here`);
  if (result.moreInTally) parts.push("more left — run it again");

  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon name="tick-square" className="size-4 text-success" />
        {result.title}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{parts.join(" · ")}</p>
      {/* The questions came over and were kept; only the responses failed. */}
      {result.responsesError ? (
        <p className="mt-1 text-xs text-destructive">{result.responsesError}</p>
      ) : null}
      {result.unmatched.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Couldn&apos;t place {result.unmatched.length} question
          {result.unmatched.length === 1 ? "" : "s"}: {result.unmatched.slice(0, 3).join(", ")}
        </p>
      ) : null}
      <SkippedNote skipped={result.skipped} />
    </>
  );
}

function SkippedNote({ skipped }: { skipped: { type: string; label: string }[] }) {
  if (skipped.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      We couldn&apos;t bring over{" "}
      <span className="text-foreground">{skipped.map((s) => s.label).join(", ")}</span> — those
      block types don&apos;t exist here yet.
    </p>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
