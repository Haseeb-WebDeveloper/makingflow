"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { enableFormSheet, pauseFormSheet } from "@/lib/actions/integrations";
import {
  CardShell,
  ComingSoonCards,
  StatusBadge,
} from "@/components/integrations/cards";
import { WebhooksCard } from "@/components/forms/webhooks-card";
import { EmailCard } from "@/components/forms/email-card";
import type {
  GoogleSheetsState,
  FormWebhook,
  FormEmailState,
} from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

export function IntegrationsPanel({
  formId,
  state,
  webhooks,
  email,
  ownerEmail,
}: {
  formId: string;
  state: GoogleSheetsState;
  webhooks: FormWebhook[];
  email: FormEmailState;
  ownerEmail: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  // Surface the OAuth round-trip result once, then strip the query param.
  React.useEffect(() => {
    const status = searchParams.get("google");
    if (!status) return;
    if (status === "connected") {
      showToast("Google connected — all forms now sync to Sheets", {
        type: "success",
      });
    } else if (status === "error") {
      const reason = searchParams.get("reason");
      showToast("Couldn't connect Google", {
        type: "error",
        description:
          reason === "denied" ? "Access was declined." : "Please try again.",
      });
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { configured, connection, status, spreadsheetUrl } = state;
  const connected = Boolean(connection);
  const on = status === "syncing" || status === "pending";

  function onToggle(next: boolean) {
    startTransition(async () => {
      const res = next
        ? await enableFormSheet(formId)
        : await pauseFormSheet(formId);
      if (res.success) {
        showToast(
          next
            ? "This form will sync to Google Sheets"
            : "Sync paused for this form",
          {
            type: "success",
          }
        );
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:gap-[0.833vw] sm:grid-cols-2 lg:grid-cols-3">
        {/* ── Google Sheets (active) ── */}
        <CardShell>
          <div className="flex items-start justify-between gap-3 lg:gap-[0.833vw]">
            <SVGIcon
              src="/logo/google-sheet.svg"
              preserveColors
              className="size-9 lg:size-[2.5vw]"
            />
            {status === "syncing" ? (
              <span className="inline-flex items-center gap-1 lg:gap-[0.278vw] rounded-full bg-success-bg px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium text-success-foreground">
                <span className="size-1.5 lg:size-[0.417vw] rounded-full bg-success" />
                Active
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 lg:mt-[0.833vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">
            Google Sheets
          </h3>
          <p className="mt-1 lg:mt-[0.278vw] flex-1 text-sm lg:text-[0.972vw] text-muted-foreground">
            {connected
              ? "New submissions are added to this form's spreadsheet as rows, in real time."
              : "Connect Google once for the whole workspace — every form syncs automatically."}
          </p>

          <div className="mt-4 lg:mt-[1.111vw] flex items-center justify-between gap-3 lg:gap-[0.833vw] border-t border-border pt-3 lg:pt-[0.833vw]">
            {!configured ? (
              <span className="text-xs lg:text-[0.833vw] text-muted-foreground">
                Not available
              </span>
            ) : connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailsOpen(true)}
              >
                View details
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/integrations/google/connect?formId=${formId}`}>
                  <Icon name="login" />
                  Connect
                </a>
              </Button>
            )}

            {configured && connected ? (
              <Switch
                checked={on}
                disabled={pending}
                onCheckedChange={onToggle}
              />
            ) : (
              <Switch checked={false} disabled />
            )}
          </div>
        </CardShell>

        {/* ── Webhooks ── */}
        <WebhooksCard formId={formId} webhooks={webhooks} />

        {/* ── Email notifications ── */}
        <EmailCard formId={formId} state={email} ownerEmail={ownerEmail} />

        {/* ── Coming soon ── */}
        <ComingSoonCards />
      </div>

      {/* ── Right-side details: this form's sheet (mirrors the workspace page) ── */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3 lg:gap-[0.833vw]">
              <SVGIcon
                src="/logo/google-sheet.svg"
                preserveColors
                className="size-9 lg:size-[2.5vw]"
              />
              <div>
                <SheetTitle>Google Sheets</SheetTitle>
                <SheetDescription>
                  {connection
                    ? `Connected as ${connection.accountEmail}`
                    : "Not connected"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 lg:px-[1.111vw] lg:px-6">
            <p className="text-sm lg:text-[0.972vw] text-muted-foreground">
              New submissions to this form are appended to its spreadsheet as
              rows, in real time. The sheet is created on the first response.
            </p>

            <div className="mt-4 lg:mt-[1.111vw] flex items-center justify-between gap-3 lg:gap-[0.833vw] rounded-lg lg:rounded-[0.694vw] border border-border p-3 lg:p-[0.833vw]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 lg:gap-[0.556vw]">
                  <StatusBadge status={status} />
                  {spreadsheetUrl ? (
                    <a
                      href={spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 lg:gap-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Open sheet
                      <Icon name="discovery" className="size-3 lg:size-[0.833vw]" />
                    </a>
                  ) : null}
                </div>
                <p className="mt-1 lg:mt-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground">
                  {status === "pending"
                    ? "The sheet is created on the first response."
                    : status === "syncing"
                    ? "Syncing new submissions automatically."
                    : "Sync is paused for this form."}
                </p>
              </div>
              <Switch
                checked={on}
                disabled={pending}
                onCheckedChange={onToggle}
              />
            </div>
          </div>

          <div className="border-t border-border p-4 lg:p-[1.111vw] lg:p-6">
            <Button asChild variant="outline" size="sm">
              <Link href="/integrations">
                <Icon name="swap" />
                Manage all integrations
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
