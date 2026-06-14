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
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { CardShell } from "@/components/integrations/cards";
import {
  saveEmailNotification,
  removeEmailNotification,
} from "@/lib/actions/email";
import type { FormEmailState } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

export function EmailCard({
  formId,
  state,
  ownerEmail,
}: {
  formId: string;
  state: FormEmailState;
  ownerEmail: string;
}) {
  const router = useRouter();
  const { configured, notification } = state;
  const active = Boolean(notification?.enabled);

  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [recipients, setRecipients] = React.useState(
    notification?.recipients.join("\n") || ownerEmail
  );
  const [includeAnswers, setIncludeAnswers] = React.useState(
    notification?.includeAnswers ?? true
  );
  const [enabled, setEnabled] = React.useState(notification?.enabled ?? true);

  function onSave() {
    startTransition(async () => {
      const res = await saveEmailNotification(formId, {
        recipients,
        includeAnswers,
        enabled,
      });
      if (res.success) {
        showToast("Email notifications saved", { type: "success" });
        setOpen(false);
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  function onRemove() {
    startTransition(async () => {
      const res = await removeEmailNotification(formId);
      if (res.success) {
        showToast("Email notifications removed", { type: "success" });
        setOpen(false);
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  const recipientCount = notification?.recipients.length ?? 0;

  return (
    <>
      <CardShell>
        <div className="flex items-start justify-between gap-3 lg:gap-[0.833vw]">
          <SVGIcon src="/logo/email.svg" preserveColors className="size-9 lg:size-[2.5vw]" />
          {active ? (
            <span className="inline-flex items-center gap-1 lg:gap-[0.278vw] rounded-full bg-success-bg px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium text-success-foreground">
              <span className="size-1.5 lg:size-[0.417vw] rounded-full bg-success" />
              On
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 lg:mt-[0.833vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">
          Email notifications
        </h3>
        <p className="mt-1 lg:mt-[0.278vw] flex-1 text-sm lg:text-[0.972vw] text-muted-foreground">
          Get an email the moment someone responds, with the answers included.
        </p>

        <div className="mt-4 lg:mt-[1.111vw] flex items-center justify-between gap-3 lg:gap-[0.833vw] border-t border-border pt-3 lg:pt-[0.833vw]">
          <span className="text-xs lg:text-[0.833vw] text-muted-foreground">
            {!configured
              ? "Not available"
              : notification
              ? active
                ? `${recipientCount} recipient${
                    recipientCount === 1 ? "" : "s"
                  }`
                : "Paused"
              : "Not set up"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!configured}
            onClick={() => setOpen(true)}
          >
            Configure
          </Button>
        </div>
      </CardShell>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Email notifications</SheetTitle>
            <SheetDescription>
              We&apos;ll email these people when this form gets a new response.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:gap-[1.111vw] overflow-y-auto px-4 lg:px-[1.111vw]">
            <div>
              <label
                htmlFor="email-recipients"
                className="text-sm lg:text-[0.972vw] font-medium text-foreground"
              >
                Recipients
              </label>
              <p className="mb-1.5 lg:mb-[0.417vw] text-xs lg:text-[0.833vw] text-muted-foreground">
                One email per line.
              </p>
              <textarea
                id="email-recipients"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                rows={4}
                spellCheck={false}
                disabled={pending}
                className="w-full rounded-md lg:rounded-[0.556vw] border border-input bg-input/30 px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] outline-none focus-visible:border-ring disabled:opacity-50"
                placeholder="you@company.com"
              />
            </div>

            <label className="flex items-center justify-between gap-4 lg:gap-[1.111vw]">
              <span>
                <span className="block text-sm lg:text-[0.972vw] font-medium text-foreground">
                  Include answers
                </span>
                <span className="block text-xs lg:text-[0.833vw] text-muted-foreground">
                  Put the submitted answers in the email body.
                </span>
              </span>
              <Switch
                checked={includeAnswers}
                disabled={pending}
                onCheckedChange={setIncludeAnswers}
              />
            </label>

            <label className="flex items-center justify-between gap-4 lg:gap-[1.111vw] border-t border-border pt-4 lg:pt-[1.111vw]">
              <span>
                <span className="block text-sm lg:text-[0.972vw] font-medium text-foreground">
                  Send notifications
                </span>
                <span className="block text-xs lg:text-[0.833vw] text-muted-foreground">
                  Pause without deleting the recipients.
                </span>
              </span>
              <Switch
                checked={enabled}
                disabled={pending}
                onCheckedChange={setEnabled}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 lg:gap-[0.556vw] border-t border-border p-4 lg:p-[1.111vw]">
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
