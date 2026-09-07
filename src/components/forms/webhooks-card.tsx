"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { CardShell } from "@/components/integrations/cards";
import {
  addWebhook,
  toggleWebhook,
  removeWebhook,
  sendTestWebhook,
  listWebhookDeliveries,
  getWebhookDelivery,
  redeliverWebhook,
} from "@/lib/actions/webhooks";
import type { DeliveryDetail, DeliveryView } from "@/lib/core/webhooks";
import type { FormWebhook } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

/**
 * How a delivery reads at a glance.
 *
 * `pending` deliberately says "Queued" rather than "Pending": a person looking
 * at a failed webhook needs to know we are still going to retry it, and
 * "pending" reads like "nothing is happening".
 */
const DELIVERY_LABEL: Record<DeliveryView["status"], string> = {
  pending: "Queued",
  sending: "Sending",
  succeeded: "Delivered",
  exhausted: "Failed",
};

function DeliveryStatus({ status }: { status: DeliveryView["status"] }) {
  const tone =
    status === "succeeded"
      ? "bg-success-bg text-success-foreground"
      : status === "exhausted"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {DELIVERY_LABEL[status]}
    </span>
  );
}

export function WebhooksCard({
  formId,
  webhooks,
}: {
  formId: string;
  webhooks: FormWebhook[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [secret, setSecret] = React.useState("");
  // Which endpoint's history is open, what it holds, and which single delivery
  // has been expanded. Deliveries are fetched on demand rather than passed in:
  // they change on every submission, so anything rendered from the page's cache
  // would be stale by the time it is read.
  const [logFor, setLogFor] = React.useState<FormWebhook | null>(null);
  const [deliveries, setDeliveries] = React.useState<DeliveryView[] | null>(null);
  const [detail, setDetail] = React.useState<DeliveryDetail | null>(null);

  const loadDeliveries = React.useCallback(async (integrationId: string) => {
    setDeliveries(null);
    const res = await listWebhookDeliveries(integrationId);
    setDeliveries(res.success ? res.deliveries : []);
    if (!res.success) showToast(res.error, { type: "error" });
  }, []);

  function openLog(webhook: FormWebhook) {
    setLogFor(webhook);
    setDetail(null);
    void loadDeliveries(webhook.id);
  }

  function openDetail(deliveryId: string) {
    startTransition(async () => {
      const res = await getWebhookDelivery(deliveryId);
      if (res.success) setDetail(res.delivery);
      else showToast(res.error, { type: "error" });
    });
  }

  function resend(deliveryId: string) {
    startTransition(async () => {
      const res = await redeliverWebhook(deliveryId);
      if (!res.success) {
        showToast(res.error, { type: "error" });
        return;
      }
      showToast("Queued for redelivery", { type: "success" });
      setDetail(null);
      if (logFor) await loadDeliveries(logFor.id);
    });
  }

  const activeCount = webhooks.filter((w) => w.enabled).length;

  function run(
    action: () => Promise<{ success: boolean; error?: string }>,
    ok: string
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        showToast(ok, { type: "success" });
        router.refresh();
      } else {
        showToast(res.error ?? "Something went wrong", { type: "error" });
      }
    });
  }

  function onAdd() {
    if (!url.trim()) return;
    startTransition(async () => {
      const res = await addWebhook(formId, {
        url,
        secret: secret || undefined,
      });
      if (res.success) {
        showToast("Webhook added", { type: "success" });
        setUrl("");
        setSecret("");
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  function onTest(id: string) {
    setTestingId(id);
    startTransition(async () => {
      const res = await sendTestWebhook(id);
      setTestingId(null);
      if (res.success) {
        showToast(`Test delivered${res.status ? ` (${res.status})` : ""}`, {
          type: "success",
        });
      } else {
        showToast("Test failed", {
          type: "error",
          description:
            res.error ??
            (res.status ? `Endpoint returned ${res.status}` : undefined),
        });
      }
    });
  }

  return (
    <>
      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <SVGIcon src="/logo/webhook.svg" preserveColors className="size-9" />
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              {activeCount} active
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">Webhooks</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          POST each new submission to your own endpoint, optionally signed for
          verification.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            {webhooks.length === 0
              ? "No endpoints yet"
              : `${webhooks.length} endpoint${
                  webhooks.length === 1 ? "" : "s"
                }`}
          </span>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Configure
          </Button>
        </div>
      </CardShell>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Webhooks</SheetTitle>
            <SheetDescription>
              Each new submission is sent as JSON. Add a secret to receive a
              signed <span className="font-mono">X-MakingFlow-Signature</span>{" "}
              header.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            {webhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No endpoints yet. Add one below.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {webhooks.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-foreground">
                        {w.url}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        {w.hasSecret ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Icon name="lock" className="size-3" />
                            Signed
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            Unsigned
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onTest(w.id)}
                          disabled={pending}
                          className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                        >
                          {testingId === w.id ? "Testing…" : "Send test"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openLog(w)}
                          className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          Deliveries
                        </button>
                      </div>
                    </div>
                    <Switch
                      checked={w.enabled}
                      disabled={pending}
                      onCheckedChange={(next) =>
                        run(
                          () => toggleWebhook(w.id, next),
                          next ? "Webhook enabled" : "Webhook paused"
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      aria-label="Remove webhook"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        run(() => removeWebhook(w.id), "Webhook removed")
                      }
                    >
                      <Icon name="delete" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Add endpoint
              </p>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/makingflow"
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Signing secret (optional)"
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
              <Button
                onClick={onAdd}
                disabled={pending || !url.trim()}
                className="w-full"
              >
                <Icon name="plus" />
                Add endpoint
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Delivery history ──
          Every response we owed this endpoint, and what became of it. This is
          the whole point of recording deliveries: before, a failed webhook was
          a line in a log nobody could read, and the only honest answer to "did
          it arrive?" was a shrug. */}
      <Sheet
        open={Boolean(logFor)}
        onOpenChange={(open) => {
          if (!open) {
            setLogFor(null);
            setDetail(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="thin-scroll w-full overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>Deliveries</SheetTitle>
            <SheetDescription className="break-all font-mono text-xs">
              {logFor?.url}
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-6">
            {deliveries === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing sent to this endpoint yet. Deliveries appear here as responses come in.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {deliveries.map((d) => (
                  <li key={d.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <DeliveryStatus status={d.status} />
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
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Sent
                          </p>
                          <pre className="thin-scroll mt-1 max-h-56 overflow-auto text-[11px] leading-relaxed">
                            <code>{JSON.stringify(detail.payload, null, 2)}</code>
                          </pre>
                        </div>
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
                        {/* Only offered once a delivery is finished — re-queueing
                            one that is still in flight would reset its backoff. */}
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
    </>
  );
}
