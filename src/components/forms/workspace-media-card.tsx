"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Loading } from "@/components/ui/loading";
import {
  listPendingMediaForms,
  rehostFormMedia,
  type PendingMediaForm,
} from "@/lib/actions/rehost-media";

/** Passes per form, so a bad cursor can't spin forever. */
const MAX_PASSES = 2000;

/**
 * Move every file in the workspace off the tool it was imported from.
 *
 * The per-form sweep on a form's settings page is the right unit of work; this
 * is the right unit of EFFORT. A real migration here left 13,393 uploads spread
 * over 68 forms, and "visit 68 settings pages before you close your old
 * account" is not a plan someone will finish.
 *
 * Driven from the browser rather than a background job, because each pass is a
 * Server Action bounded by the route's budget and every pass commits what it
 * moved. Closing the tab loses nothing but the remaining work, and starting
 * again picks up exactly where it stopped — anything already on our storage is
 * skipped.
 */
export function WorkspaceMediaCard() {
  const router = useRouter();
  const [pending, setPending] = React.useState<PendingMediaForm[] | null>(null);
  const [running, setRunning] = React.useState(false);
  const [moved, setMoved] = React.useState(0);
  const [failed, setFailed] = React.useState(0);
  const [at, setAt] = React.useState<{ form: string; index: number; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  // Lets an in-flight run finish the current pass and stop cleanly.
  const stop = React.useRef(false);

  React.useEffect(() => {
    let live = true;
    listPendingMediaForms().then((r) => {
      if (!live) return;
      if (r.success) setPending(r.forms);
    });
    return () => {
      live = false;
    };
  }, []);

  async function run() {
    if (running || !pending?.length) return;
    setRunning(true);
    setError(null);
    stop.current = false;
    let total = 0;
    let bad = 0;

    for (const [index, form] of pending.entries()) {
      if (stop.current) break;
      setAt({ form: form.title, index, total: pending.length });

      let cursor: string | null | undefined = undefined;
      for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const result = await rehostFormMedia(form.id, cursor);
        if (!result.success) {
          // One form failing shouldn't abandon the other 67.
          setError(`${form.title}: ${result.error}`);
          break;
        }
        total += result.assets + result.files;
        bad += result.failed;
        setMoved(total);
        setFailed(bad);
        if (!result.cursor || stop.current) break;
        cursor = result.cursor;
      }
    }

    setAt(null);
    setRunning(false);
    setDone(!stop.current);
    router.refresh();
  }

  if (!pending || pending.length === 0) return null;

  const files = pending.reduce((n, f) => n + f.files, 0);
  const assets = pending.reduce((n, f) => n + f.assets, 0);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon name="danger-circle" className="size-4 shrink-0 text-destructive" />
        {files + assets} imported file{files + assets === 1 ? "" : "s"} still hosted by Tally
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {done ? (
          <>Moved {moved} onto your own storage.</>
        ) : (
          <>
            Across {pending.length} form{pending.length === 1 ? "" : "s"}
            {files > 0 ? `, including ${files} respondent upload${files === 1 ? "" : "s"}` : ""}.
            These break the moment that Tally account is closed. This runs in your browser — leave
            the tab open; stopping early keeps whatever it has already moved.
          </>
        )}
        {failed > 0 ? (
          <>
            {" "}
            {failed} couldn&apos;t be fetched, most likely already deleted at the source.
          </>
        ) : null}
      </p>

      {at ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Form {at.index + 1} of {at.total} — {at.form} · {moved} moved
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {!done ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={running} onClick={run} className="gap-1.5">
            {running ? <Loading fill className="size-4" /> : <Icon name="upload" className="size-4" />}
            {running ? `Moving… ${moved}` : "Move all files here"}
          </Button>
          {running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                stop.current = true;
              }}
            >
              Stop
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
