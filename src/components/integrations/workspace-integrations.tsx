"use client";

import * as React from "react";
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
import {
  enableFormSheet,
  pauseFormSheet,
  disconnectGoogle,
} from "@/lib/actions/integrations";
import {
  CardShell,
  ComingSoonCards,
  StatusBadge,
} from "@/components/integrations/cards";
import type { WorkspaceIntegrations } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

export function WorkspaceIntegrationsPanel({
  data,
}: {
  data: WorkspaceIntegrations;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [detailsOpen, setDetailsOpen] = React.useState(false);

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

  const { configured, connection, forms } = data;
  const connected = Boolean(connection);
  const syncingCount = forms.filter((f) => f.status === "syncing").length;

  function run(
    action: () => Promise<{ success: boolean; error?: string }>,
    ok: string,
    onSuccess?: () => void
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        showToast(ok, { type: "success" });
        router.refresh();
        onSuccess?.();
      } else {
        showToast(res.error ?? "Something went wrong", { type: "error" });
      }
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* ── Google Sheets ── */}
        <CardShell>
          <div className="flex items-start justify-between gap-3">
            <SVGIcon
              src="/logo/google-sheet.svg"
              preserveColors
              className="size-9"
            />
            {connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                Connected
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Google Sheets
          </h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            {connected
              ? `Every form syncs new submissions to its own spreadsheet automatically.${
                  syncingCount > 0 ? ` ${syncingCount} active.` : ""
                }`
              : "Connect once for the whole workspace — every form, current and future, syncs to Sheets automatically."}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            {!configured ? (
              <span className="text-xs text-muted-foreground">
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
                <a href="/api/integrations/google/connect">
                  <Icon name="login" />
                  Connect
                </a>
              </Button>
            )}

            {configured && connected ? (
              <Switch
                checked
                disabled={pending}
                onCheckedChange={() =>
                  run(() => disconnectGoogle(), "Google disconnected")
                }
              />
            ) : (
              <Switch checked={false} disabled />
            )}
          </div>
        </CardShell>

        {/* ── Coming soon ── */}
        <ComingSoonCards />
      </div>

      {/* ── Right-side details: per-form sync ── */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon
                src="/logo/google-sheet.svg"
                preserveColors
                className="size-9"
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

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            <p className="text-sm text-muted-foreground">
              Every form sends new submissions to its own spreadsheet. A
              form&apos;s sheet is created on its first response — new forms are
              added automatically.
            </p>

            <div className="mt-4 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Forms
              </h4>
              <span className="text-xs text-muted-foreground">
                {forms.length} total
              </span>
            </div>

            {forms.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No forms yet. New forms sync automatically once they receive a
                response.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {forms.map((f) => {
                  const on = f.status === "syncing" || f.status === "pending";
                  return (
                    <li key={f.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {f.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <StatusBadge status={f.status} />
                          {f.spreadsheetUrl ? (
                            <a
                              href={f.spreadsheetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              Open sheet
                              <Icon name="discovery" className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <Switch
                        checked={on}
                        disabled={pending}
                        onCheckedChange={(next) =>
                          next
                            ? run(
                                () => enableFormSheet(f.id),
                                `“${f.title}” will sync to Sheets`
                              )
                            : run(
                                () => pauseFormSheet(f.id),
                                `Paused sync for “${f.title}”`
                              )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-border p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => disconnectGoogle(),
                  "Google disconnected",
                  () => setDetailsOpen(false)
                )
              }
            >
              <Icon name="logout" />
              Disconnect Google
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
