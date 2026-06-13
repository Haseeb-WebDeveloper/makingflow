"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { enableFormSheet, pauseFormSheet } from "@/lib/actions/integrations";
import { CardShell, ComingSoonCards } from "@/components/integrations/cards";
import type { GoogleSheetsState } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

export function IntegrationsPanel({
  formId,
  state,
}: {
  formId: string;
  state: GoogleSheetsState;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

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

  // The left-hand status line in the Google card footer.
  let footerLead: React.ReactNode;
  if (!configured) {
    footerLead = (
      <span className="text-xs text-muted-foreground">Not available</span>
    );
  } else if (!connected) {
    footerLead = (
      <Button asChild size="sm" variant="outline">
        <a href={`/api/integrations/google/connect?formId=${formId}`}>
          <Icon name="login" />
          Connect
        </a>
      </Button>
    );
  } else if (status === "syncing" && spreadsheetUrl) {
    footerLead = (
      <a
        href={spreadsheetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
      >
        Open spreadsheet
        <Icon name="discovery" className="size-3.5" />
      </a>
    );
  } else if (status === "pending") {
    footerLead = (
      <span className="text-xs text-muted-foreground">
        Sheet created on first response
      </span>
    );
  } else {
    footerLead = <span className="text-xs text-muted-foreground">Paused</span>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* ── Google Sheets (active) ── */}
      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <SVGIcon src="/integrations/sheets.svg" className="size-9" />
          {status === "syncing" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Active
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">
          Google Sheets
        </h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          {connected
            ? "New submissions are added to this form's spreadsheet as rows, in real time."
            : "Connect Google once for the whole workspace — every form syncs automatically."}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          {footerLead}
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

        {configured && connected ? (
          <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              Connected as {connection!.accountEmail}
            </span>
            <Link
              href="/integrations"
              className="shrink-0 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Manage
            </Link>
          </div>
        ) : null}
      </CardShell>

      {/* ── Coming soon ── */}
      <ComingSoonCards />
    </div>
  );
}
