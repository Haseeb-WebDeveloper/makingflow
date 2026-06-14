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
} from "@/lib/actions/webhooks";
import type { FormWebhook } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

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
        <div className="flex items-start justify-between gap-3 lg:gap-[0.833vw]">
          <SVGIcon src="/logo/webhook.svg" preserveColors className="size-9 lg:size-[2.5vw]" />
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1 lg:gap-[0.278vw] rounded-full bg-success-bg px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium text-success-foreground">
              <span className="size-1.5 lg:size-[0.417vw] rounded-full bg-success" />
              {activeCount} active
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 lg:mt-[0.833vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">Webhooks</h3>
        <p className="mt-1 lg:mt-[0.278vw] flex-1 text-sm lg:text-[0.972vw] text-muted-foreground">
          POST each new submission to your own endpoint, optionally signed for
          verification.
        </p>

        <div className="mt-4 lg:mt-[1.111vw] flex items-center justify-between gap-3 lg:gap-[0.833vw] border-t border-border pt-3 lg:pt-[0.833vw]">
          <span className="text-xs lg:text-[0.833vw] text-muted-foreground">
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

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 lg:px-[1.111vw]">
            {webhooks.length === 0 ? (
              <p className="text-sm lg:text-[0.972vw] text-muted-foreground">
                No endpoints yet. Add one below.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {webhooks.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 lg:gap-[0.833vw] py-3 lg:py-[0.833vw]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs lg:text-[0.833vw] text-foreground">
                        {w.url}
                      </p>
                      <div className="mt-1 lg:mt-[0.278vw] flex items-center gap-2 lg:gap-[0.556vw]">
                        {w.hasSecret ? (
                          <span className="inline-flex items-center gap-1 lg:gap-[0.278vw] text-[11px] lg:text-[0.764vw] text-muted-foreground">
                            <Icon name="lock" className="size-3 lg:size-[0.833vw]" />
                            Signed
                          </span>
                        ) : (
                          <span className="text-[11px] lg:text-[0.764vw] text-muted-foreground">
                            Unsigned
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onTest(w.id)}
                          disabled={pending}
                          className="text-[11px] lg:text-[0.764vw] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                        >
                          {testingId === w.id ? "Testing…" : "Send test"}
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

            <div className="mt-4 lg:mt-[1.111vw] space-y-2 lg:space-y-[0.556vw] border-t border-border pt-4 lg:pt-[1.111vw]">
              <p className="text-xs lg:text-[0.833vw] font-medium uppercase tracking-wide text-muted-foreground">
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
    </>
  );
}
