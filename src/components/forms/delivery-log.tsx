"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import {
  listDeliveries,
  getDelivery,
  redeliverDelivery,
} from "@/lib/actions/deliveries";
import type { DeliveryDetail, DeliverySelector, DeliveryView } from "@/lib/core/deliveries";

/**
 * What became of the responses owed to one destination.
 *
 * SHARED BY EVERY INTEGRATION, which is the point. This started inside the
 * webhooks card, and every other integration had no answer at all to "did my
 * response reach it?" — a Sheets sync that failed was a console line nobody
 * could read. Now that all five deliver through the same queue, they can all
 * show the same history, and one component means the answer reads the same way
 * wherever it is asked.
 *
 * Fetched on open rather than passed in from the page. Delivery state changes
 * on every submission and every retry, so anything rendered from a cached page
 * would be stale by the time somebody opened it to investigate — which is
 * exactly the moment being wrong is most expensive.
 */

/**
 * `pending` reads as "Queued", deliberately.
 *
 * Someone looking at a failed delivery needs to know we are still going to
 * retry it. "Pending" reads like nothing is happening, which invites them to
 * go and rebuild by hand what we are about to deliver anyway.
 */
const LABEL: Record<DeliveryView["status"], string> = {
  pending: "Queued",
  sending: "Sending",
  succeeded: "Delivered",
  exhausted: "Failed",
};

export function DeliveryStatusPill({ status }: { status: DeliveryView["status"] }) {
  const tone =
    status === "succeeded"
      ? "bg-success-bg text-success-foreground"
      : status === "exhausted"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {LABEL[status]}
    </span>
  );
}

export function DeliveryLog({
  open,
  onOpenChange,
  title,
  destination,
  selector,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The integration's name — "Webhooks", "Google Sheets". */
  title: string;
  /** Which one, when there can be several. Shown under the title. */
  destination?: string;
  selector: DeliverySelector | null;
}) {
  const [rows, setRows] = React.useState<DeliveryView[] | null>(null);
  const [detail, setDetail] = React.useState<DeliveryDetail | null>(null);
  const [pending, startTransition] = React.useTransition();

  const load = React.useCallback(async () => {
    if (!selector) return;
    const res = await listDeliveries(selector);
    setRows(res.success ? res.deliveries : []);
    setDetail(null);
    if (!res.success) showToast(res.error, { type: "error" });
  }, [selector]);

  // Re-fetch whenever the sheet is opened, so reopening after a retry shows
  // what happened rather than what was true last time.
  //
  // The cancellation flag is not ceremony: opening, closing and reopening
  // quickly leaves two requests in flight, and without it the slower one lands
  // last and overwrites the fresher list with older state.
  React.useEffect(() => {
    if (!open || !selector) return;
    let cancelled = false;
    void (async () => {
      const res = await listDeliveries(selector);
      if (cancelled) return;
      setRows(res.success ? res.deliveries : []);
      if (!res.success) showToast(res.error, { type: "error" });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selector]);

  function openDetail(id: string) {
    startTransition(async () => {
      const res = await getDelivery(id);
      if (res.success) setDetail(res.delivery);
      else showToast(res.error, { type: "error" });
    });
  }

  function resend(id: string) {
    startTransition(async () => {
      const res = await redeliverDelivery(id);
      if (!res.success) {
        showToast(res.error, { type: "error" });
        return;
      }
      showToast("Queued for redelivery", { type: "success" });
      setDetail(null);
      await load();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="thin-scroll w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={destination ? "break-all font-mono text-xs" : undefined}>
            {destination ?? "Every response owed to this destination, and what became of it."}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          {rows === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing sent here yet. Deliveries appear as responses come in.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <DeliveryStatusPill status={d.status} />
                        <span className="truncate text-xs text-muted-foreground">
                          {new Date(d.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {d.lastStatus ? `HTTP ${d.lastStatus}` : d.lastError || d.event}
                        {d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => openDetail(d.id)}
                    >
                      View
                    </Button>
                  </div>

                  {detail?.id === d.id ? (
                    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
                      {/* Only a webhook snapshots what it sent. The rest render
                          from the answers at send time, so there is no body to
                          show — saying so beats an empty box. */}
                      {detail.payload ? (
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Sent
                          </p>
                          <pre className="thin-scroll mt-1 max-h-56 overflow-auto text-[11px] leading-relaxed">
                            <code>{JSON.stringify(detail.payload, null, 2)}</code>
                          </pre>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Built from the response when it was sent, so there is no stored copy.
                        </p>
                      )}

                      {detail.responseBody ? (
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Response
                          </p>
                          <pre className="thin-scroll mt-1 max-h-32 overflow-auto text-[11px] leading-relaxed">
                            <code>{detail.responseBody}</code>
                          </pre>
                        </div>
                      ) : null}

                      {detail.lastError ? (
                        <p className="text-xs text-destructive">{detail.lastError}</p>
                      ) : null}

                      {/* Only once a delivery is finished — re-queueing one
                          still in flight would reset its backoff. */}
                      {detail.status === "succeeded" || detail.status === "exhausted" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => resend(detail.id)}
                        >
                          <Icon name="swap" className="size-3.5" />
                          Redeliver
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
