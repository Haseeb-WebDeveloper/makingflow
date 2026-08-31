"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Loading } from "@/components/ui/loading";
import { rehostFormMedia } from "@/lib/actions/rehost-media";

/** Passes before we stop, so a bad cursor can't spin forever. */
const MAX_PASSES = 400;

/**
 * Move a migrated form's files onto our storage.
 *
 * Shown only while something still points at Tally. The reason it exists at all
 * is the one thing a migration can't undo: the imported answers reference files
 * hosted by the tool being left behind, so closing that account turns every
 * uploaded CV into a dead link. This copies them across first.
 *
 * Driven from the client in passes, because a form here can carry thousands of
 * uploads and no single request should be asked to finish that. Each pass
 * commits what it moved, so stopping halfway keeps the half that ran.
 */
export function RehostMediaCard({
  formId,
  files,
  assets,
}: {
  formId: string;
  files: number;
  assets: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [moved, setMoved] = React.useState(0);
  const [failed, setFailed] = React.useState(0);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let cursor: string | null | undefined = undefined;
    let total = 0;
    let bad = 0;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const result = await rehostFormMedia(formId, cursor);
      if (!result.success) {
        setError(result.error);
        break;
      }
      total += result.assets + result.files;
      bad += result.failed;
      setMoved(total);
      setFailed(bad);
      if (!result.cursor) {
        setDone(true);
        break;
      }
      cursor = result.cursor;
    }

    setBusy(false);
    router.refresh();
  }

  const pending = files + assets;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon name="download" className="size-4 shrink-0" />
        Files still hosted by Tally
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {done ? (
          <>
            Moved {moved} file{moved === 1 ? "" : "s"} onto your own storage.
            {failed > 0
              ? ` ${failed} couldn't be fetched — those were most likely already deleted at the source.`
              : ""}
          </>
        ) : (
          <>
            {files > 0 ? (
              <>
                {files} response{files === 1 ? "" : "s"} still link to files on Tally
                {assets > 0 ? `, plus ${assets} form image${assets === 1 ? "" : "s"}` : ""}.{" "}
              </>
            ) : (
              <>
                {assets} form image{assets === 1 ? "" : "s"} still {assets === 1 ? "lives" : "live"}{" "}
                on Tally.{" "}
              </>
            )}
            If you close that Tally account they become dead links. Copy them here first.
          </>
        )}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {!done ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-1.5"
          disabled={busy || pending === 0}
          onClick={run}
        >
          {busy ? <Loading fill className="size-4" /> : <Icon name="upload" className="size-4" />}
          {busy ? `Moving… ${moved} done` : "Move files here"}
        </Button>
      ) : null}
    </div>
  );
}
