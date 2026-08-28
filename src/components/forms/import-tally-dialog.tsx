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
  importTallySubmissions,
  type ImportFormResult,
} from "@/lib/actions/import-tally";

/** A CSV bigger than this is a data migration, not a form move. */
const MAX_CSV_BYTES = 5_000_000;

type Imported = Extract<ImportFormResult, { success: true }>;

/**
 * Move a form over from Tally, in two steps.
 *
 * Step one needs only the public share link — the same URL they give
 * respondents — because a Tally form page carries its own definition. Step two
 * is optional and takes the CSV export, since the page has the questions but
 * never the answers.
 *
 * The steps are deliberately separate: the form is created and kept the moment
 * step one succeeds, so closing the dialog here loses nothing.
 */
export function ImportTallyDialog({
  trigger,
  className,
}: {
  trigger?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [imported, setImported] = React.useState<Imported | null>(null);
  const [responses, setResponses] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setUrl("");
    setError(null);
    setImported(null);
    setResponses(null);
    setBusy(false);
  }

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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
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
            {imported
              ? "Your questions are in. Bring the responses over too, or open the form and start editing."
              : "Paste the share link to your Tally form. We'll rebuild its questions here — no Tally account needed."}
          </DialogDescription>
        </DialogHeader>

        {!imported ? (
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
        ) : (
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
              {imported.skipped.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  We couldn&apos;t bring over{" "}
                  <span className="text-foreground">
                    {imported.skipped.map((s) => s.label).join(", ")}
                  </span>{" "}
                  — those block types don&apos;t exist here yet.
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-sm font-medium text-foreground">Responses (optional)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                In Tally, open this form&apos;s Submissions tab and click Download CSV. Importing
                the same file twice is safe — we skip what&apos;s already here.
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
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
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
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
