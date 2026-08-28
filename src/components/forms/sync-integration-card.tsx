"use client";

import * as React from "react";
import Link from "next/link";
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
import { CardShell, StatusBadge } from "@/components/integrations/cards";
import {
  enableFormSheet,
  pauseFormSheet,
  enableFormNotion,
  pauseFormNotion,
} from "@/lib/actions/integrations";
import type { FormSyncStatus } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

type Result = { success: boolean; error?: string };

/**
 * The "connect once for the workspace, sync every form" integrations share an
 * identical per-form card + details sheet + pause toggle. Only the labels,
 * icon, destination noun, connect URL, and the enable/pause actions differ —
 * captured here per provider so Google Sheets and Notion reuse one component.
 */
const PROVIDERS = {
  google: {
    name: "Google Sheets",
    iconSrc: "/logo/google-sheet.svg",
    destinationNoun: "spreadsheet",
    openLabel: "Open sheet",
    enable: enableFormSheet,
    pause: pauseFormSheet,
  },
  notion: {
    name: "Notion",
    iconSrc: "/logo/notion.svg",
    destinationNoun: "Notion database",
    openLabel: "Open database",
    enable: enableFormNotion,
    pause: pauseFormNotion,
  },
} as const;

export type SyncProvider = keyof typeof PROVIDERS;

export function SyncIntegrationCard({
  formId,
  provider,
  configured,
  connectionLabel,
  status,
  destinationUrl,
}: {
  formId: string;
  provider: SyncProvider;
  configured: boolean;
  /** e.g. "Connected as a@b.com" / "Connected to Acme" — null when not connected. */
  connectionLabel: string | null;
  status: FormSyncStatus;
  destinationUrl: string | null;
}) {
  const router = useRouter();
  const { name, iconSrc, destinationNoun, openLabel, enable, pause } =
    PROVIDERS[provider];
  const connected = connectionLabel !== null;
  const on = status === "syncing" || status === "pending";

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function onToggle(next: boolean) {
    startTransition(async () => {
      const res: Result = next ? await enable(formId) : await pause(formId);
      if (res.success) {
        showToast(
          next ? `This form will sync to ${name}` : "Sync paused for this form",
          { type: "success" }
        );
        router.refresh();
      } else {
        showToast(res.error ?? "Something went wrong", {
          type: "error",
          duration: 12000,
        });
      }
    });
  }

  return (
    <>
      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <SVGIcon src={iconSrc} preserveColors className="size-9" />
          {status === "syncing" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Active
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">{name}</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          {connected
            ? `Every response lands in this form's ${destinationNoun} — the ones already collected, and new ones in real time.`
            : `Connect ${name} once for the whole workspace, and every form syncs automatically.`}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          {!configured ? (
            <span className="text-xs text-muted-foreground">Not available</span>
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
              <a
                href={`/api/integrations/${provider}/connect?formId=${formId}`}
              >
                <SVGIcon
                  src="/icons/connect.svg"
                  preserveColors
                  className="size-4 text-foreground"
                />
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

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon src={iconSrc} preserveColors className="size-9" />
              <div>
                <SheetTitle>{name}</SheetTitle>
                <SheetDescription>
                  {connectionLabel ?? "Not connected"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 lg:px-6">
            <p className="text-sm text-muted-foreground">
              New submissions to this form are added to its {destinationNoun} as
              rows, in real time. The {destinationNoun} is created when the form
              is published — you don&apos;t need a response first — and responses
              collected before you turned this on are copied across in the
              background, so nothing is left behind.
            </p>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  {destinationUrl ? (
                    <a
                      href={destinationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {openLabel}
                      <Icon name="discovery" className="size-3" />
                    </a>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status === "pending"
                    ? `This form has no ${destinationNoun} yet.`
                    : status === "syncing"
                    ? "Syncing new submissions automatically."
                    : "Sync is paused for this form."}
                </p>
                {status === "pending" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={pending}
                    onClick={() => onToggle(true)}
                  >
                    Create it now
                  </Button>
                ) : null}
              </div>
              <Switch
                checked={on}
                disabled={pending}
                onCheckedChange={onToggle}
              />
            </div>
          </div>

          <div className="border-t border-border p-4 lg:p-6">
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
