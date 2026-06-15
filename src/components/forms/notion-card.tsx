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
import { enableFormNotion, pauseFormNotion } from "@/lib/actions/integrations";
import type { NotionState } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

export function NotionCard({
  formId,
  state,
}: {
  formId: string;
  state: NotionState;
}) {
  const router = useRouter();
  const { configured, connection, status, databaseUrl } = state;
  const connected = Boolean(connection);
  const on = status === "syncing" || status === "pending";

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function onToggle(next: boolean) {
    startTransition(async () => {
      const res = next ? await enableFormNotion(formId) : await pauseFormNotion(formId);
      if (res.success) {
        showToast(
          next ? "This form will sync to Notion" : "Sync paused for this form",
          { type: "success" }
        );
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
          <SVGIcon src="/logo/notion.svg" preserveColors className="size-9" />
          {status === "syncing" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Active
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">Notion</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          {connected
            ? "New submissions are added to this form's Notion database as rows, in real time."
            : "Connect Notion once for the whole workspace, every form syncs automatically."}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          {!configured ? (
            <span className="text-xs text-muted-foreground">Not available</span>
          ) : connected ? (
            <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}>
              View details
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/integrations/notion/connect?formId=${formId}`}>
                <Icon name="login" />
                Connect
              </a>
            </Button>
          )}

          {configured && connected ? (
            <Switch checked={on} disabled={pending} onCheckedChange={onToggle} />
          ) : (
            <Switch checked={false} disabled />
          )}
        </div>
      </CardShell>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon src="/logo/notion.svg" preserveColors className="size-9" />
              <div>
                <SheetTitle>Notion</SheetTitle>
                <SheetDescription>
                  {connection
                    ? `Connected to ${connection.workspaceName}`
                    : "Not connected"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 lg:px-6">
            <p className="text-sm text-muted-foreground">
              New submissions to this form are added to its Notion database as
              rows, in real time. The database is created on the first response.
            </p>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  {databaseUrl ? (
                    <a
                      href={databaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Open database
                      <Icon name="discovery" className="size-3" />
                    </a>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status === "pending"
                    ? "The database is created on the first response."
                    : status === "syncing"
                    ? "Syncing new submissions automatically."
                    : "Sync is paused for this form."}
                </p>
              </div>
              <Switch checked={on} disabled={pending} onCheckedChange={onToggle} />
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
