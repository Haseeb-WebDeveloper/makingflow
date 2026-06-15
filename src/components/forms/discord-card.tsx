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
import { showToast } from "@/components/ui/toast";
import { CardShell } from "@/components/integrations/cards";
import {
  saveDiscordWebhook,
  removeDiscordWebhook,
} from "@/lib/actions/discord";
import type { FormDiscordState } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

export function DiscordCard({
  formId,
  state,
}: {
  formId: string;
  state: FormDiscordState;
}) {
  const router = useRouter();
  const { notification } = state;
  const connected = Boolean(notification?.hasWebhook);
  const active = Boolean(notification?.enabled) && connected;

  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [webhookUrl, setWebhookUrl] = React.useState("");
  const [includeAnswers, setIncludeAnswers] = React.useState(
    notification?.includeAnswers ?? true
  );
  const [enabled, setEnabled] = React.useState(notification?.enabled ?? true);

  function onSave() {
    startTransition(async () => {
      const res = await saveDiscordWebhook(formId, {
        webhookUrl,
        includeAnswers,
        enabled,
      });
      if (res.success) {
        showToast("Discord notifications saved", { type: "success" });
        setWebhookUrl("");
        setOpen(false);
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  function onRemove() {
    startTransition(async () => {
      const res = await removeDiscordWebhook(formId);
      if (res.success) {
        showToast("Discord notifications removed", { type: "success" });
        setOpen(false);
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  return (
    <>
      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <SVGIcon src="/logo/discord.svg" preserveColors className="size-9" />
          {active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              On
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">Discord</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          Post each new response to a Discord channel via an incoming webhook.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            {!connected ? "Not set up" : active ? "Connected" : "Paused"}
          </span>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Configure
          </Button>
        </div>
      </CardShell>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Discord</SheetTitle>
            <SheetDescription>
              We&apos;ll post a message to your channel when this form gets a new
              response.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div>
              <label
                htmlFor="discord-webhook"
                className="text-sm font-medium text-foreground"
              >
                {connected ? "Replace webhook URL" : "Webhook URL"}
              </label>
              <p className="mb-1.5 text-xs text-muted-foreground">
                {connected ? (
                  <>
                    Connected ({notification?.maskedUrl}). Paste a new URL to
                    replace it, or leave blank to keep it.
                  </>
                ) : (
                  <>
                    In Discord: Server Settings → Integrations → Webhooks → New
                    Webhook → Copy Webhook URL.
                  </>
                )}
              </p>
              <Input
                id="discord-webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                placeholder="https://discord.com/api/webhooks/…"
              />
            </div>

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Include answers
                </span>
                <span className="block text-xs text-muted-foreground">
                  Put the submitted answers in the message.
                </span>
              </span>
              <Switch
                checked={includeAnswers}
                disabled={pending}
                onCheckedChange={setIncludeAnswers}
              />
            </label>

            <label className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Send messages
                </span>
                <span className="block text-xs text-muted-foreground">
                  Pause without deleting the webhook.
                </span>
              </span>
              <Switch
                checked={enabled}
                disabled={pending}
                onCheckedChange={setEnabled}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border p-4">
            {notification ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={onRemove}
                className="text-muted-foreground hover:text-destructive"
              >
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" disabled={pending} onClick={onSave}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
