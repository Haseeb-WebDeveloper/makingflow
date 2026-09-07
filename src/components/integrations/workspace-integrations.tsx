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
import {
  enableFormSheet,
  pauseFormSheet,
  disconnectGoogle,
  enableFormNotion,
  pauseFormNotion,
  disconnectNotion,
} from "@/lib/actions/integrations";
import { CardShell, StatusBadge } from "@/components/integrations/cards";
import type { WorkspaceIntegrations } from "@/lib/data/integrations";
import { McpCard, type McpCardProps } from "@/components/integrations/mcp-card";
import { SVGIcon } from "../ui/svg-icon";

/** A form in a picker: its current state for this integration, or null if unset. */
type PickerForm = { id: string; title: string; status: React.ReactNode | null };

/**
 * The list behind a per-form integration's Manage button.
 *
 * IT LISTS EVERY FORM, not only the configured ones, and that is the point.
 * These three integrations are set up per form, and the panel used to say so
 * and then show nothing at all until something was already set up — telling you
 * to "open a form's Integrations tab" while offering no way to reach one. The
 * only route was to leave, find Forms, pick one and hunt for the tab, which is
 * where people conclude the feature is missing rather than one click away.
 *
 * Showing the forms also explains the per-form model without a sentence about
 * it: here are your forms, each carries its own setup.
 *
 * Configured forms sort to the top since they are what someone returning to
 * this panel came to check; the rest keep their most-recently-edited order,
 * which puts the form you were just working on within reach.
 */
function FormPicker({
  forms,
  onNavigate,
  emptyLabel,
}: {
  forms: PickerForm[];
  onNavigate: () => void;
  /** Shown when the workspace has no forms at all — a different problem. */
  emptyLabel: string;
}) {
  if (forms.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        <p>{emptyLabel}</p>
        <Link
          href="/forms"
          onClick={onNavigate}
          className="mt-3 inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create a form
          <Icon name="discovery" className="size-4" />
        </Link>
      </div>
    );
  }

  const ordered = [
    ...forms.filter((f) => f.status !== null),
    ...forms.filter((f) => f.status === null),
  ];

  return (
    <ul className="divide-y divide-border">
      {ordered.map((f) => (
        <li key={f.id}>
          <Link
            href={`/forms/${f.id}/integrations`}
            onClick={onNavigate}
            className="group flex items-center gap-3 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground group-hover:underline">
                {f.title}
              </p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {f.status ?? "Not set up"}
              </span>
            </div>
            <Icon
              name="discovery"
              className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The "On" pill, for a form where the integration is live. */
function OnPill({ label = "On" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-success-foreground">
      <span className="size-1.5 rounded-full bg-success" />
      {label}
    </span>
  );
}

export function WorkspaceIntegrationsPanel({
  data,
  mcp,
}: {
  data: WorkspaceIntegrations;
  mcp: McpCardProps;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [emailOpen, setEmailOpen] = React.useState(false);
  const [webhookOpen, setWebhookOpen] = React.useState(false);
  const [discordOpen, setDiscordOpen] = React.useState(false);
  const [notionDetailsOpen, setNotionDetailsOpen] = React.useState(false);

  React.useEffect(() => {
    const google = searchParams.get("google");
    const notionStatus = searchParams.get("notion");
    if (!google && !notionStatus) return;

    const provider = google ? "Google" : "Notion";
    const status = google ?? notionStatus;
    if (status === "connected") {
      showToast(
        google
          ? "Google connected, all forms now sync to Sheets"
          : "Notion connected, all forms now sync to Notion",
        { type: "success" }
      );
    } else if (status === "error") {
      const reason = searchParams.get("reason");
      showToast(`Couldn't connect ${provider}`, {
        type: "error",
        description:
          reason === "denied" ? "Access was declined." : "Please try again.",
      });
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { configured, connection, allForms, forms, email, webhook, discord, notion } =
    data;
  const connected = Boolean(connection);
  const syncingCount = forms.filter((f) => f.status === "syncing").length;
  const emailActive = email.forms.some((f) => f.status === "on");
  const webhookActive = webhook.forms.reduce((n, f) => n + f.active, 0);
  const discordActive = discord.forms.some((f) => f.status === "on");
  const notionConnected = Boolean(notion.connection);
  const notionSyncingCount = notion.forms.filter(
    (f) => f.status === "syncing"
  ).length;

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
      {/* ── AI assistants (MCP) ──
          Above the grid, full width, deliberately not a tile in it. The cards
          below each add one destination for a submission; this one hands an
          assistant the whole product. Sizing it like a peer of the Discord card
          undersold what it is. */}
      <McpCard {...mcp} />

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              : "Connect once for the whole workspace, and every form, current and future, syncs to Sheets automatically."}
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

        {/* ── Email notifications (per-form; managed from each form) ── */}
        <CardShell>
          <div className="flex items-start justify-between gap-3">
            <SVGIcon src="/logo/email.svg" preserveColors className="size-9" />
            {emailActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                On
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Email notifications
          </h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            Get an email the moment a form gets a response. Set up per form,
            with the answers included.
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {!email.configured
                ? "Not available"
                : email.forms.length === 0
                ? "Not set up on any form"
                : `${email.forms.length} form${
                    email.forms.length === 1 ? "" : "s"
                  } configured`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!email.configured}
              onClick={() => setEmailOpen(true)}
            >
              Manage
            </Button>
          </div>
        </CardShell>

        {/* ── Webhooks (per-form; managed from each form) ── */}
        <CardShell>
          <div className="flex items-start justify-between gap-3">
            <SVGIcon
              src="/logo/webhook.svg"
              preserveColors
              className="size-9"
            />
            {webhookActive > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                {webhookActive} active
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Webhooks
          </h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            POST each new submission to your own endpoint, optionally signed.
            Set up per form.
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {webhook.forms.length === 0
                ? "Not set up on any form"
                : `${webhook.forms.length} form${
                    webhook.forms.length === 1 ? "" : "s"
                  } configured`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWebhookOpen(true)}
            >
              Manage
            </Button>
          </div>
        </CardShell>

        {/* ── Discord (per-form; managed from each form) ── */}
        <CardShell>
          <div className="flex items-start justify-between gap-3">
            <SVGIcon
              src="/logo/discord.svg"
              preserveColors
              className="size-9"
            />
            {discordActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                On
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Discord
          </h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            Post each new response to a Discord channel via an incoming webhook.
            Set up per form.
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {discord.forms.length === 0
                ? "Not set up on any form"
                : `${discord.forms.length} form${
                    discord.forms.length === 1 ? "" : "s"
                  } configured`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDiscordOpen(true)}
            >
              Manage
            </Button>
          </div>
        </CardShell>

        {/* ── Notion ── */}
        <CardShell>
          <div className="flex items-start justify-between gap-3">
            <SVGIcon src="/logo/notion.svg" preserveColors className="size-9" />
            {notionConnected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                Connected
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">Notion</h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            {notionConnected
              ? `Every form syncs new submissions to its own Notion database automatically.${
                  notionSyncingCount > 0 ? ` ${notionSyncingCount} active.` : ""
                }`
              : "Connect once for the whole workspace, and every form, current and future, syncs to Notion automatically."}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            {!notion.configured ? (
              <span className="text-xs text-muted-foreground">
                Not available
              </span>
            ) : notionConnected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNotionDetailsOpen(true)}
              >
                View details
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <a href="/api/integrations/notion/connect">
                  <SVGIcon
                    src="/icons/connect.svg"
                    preserveColors
                    className="size-4 text-foreground"
                  />
                  Connect
                </a>
              </Button>
            )}

            {notion.configured && notionConnected ? (
              <Switch
                checked
                disabled={pending}
                onCheckedChange={() =>
                  run(() => disconnectNotion(), "Notion disconnected")
                }
              />
            ) : (
              <Switch checked={false} disabled />
            )}
          </div>
        </CardShell>
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
              form&apos;s sheet is created on its first response, and new forms
              are added automatically.
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

      {/* ── Email: per-form management list ── */}
      <Sheet open={emailOpen} onOpenChange={setEmailOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon
                src="/logo/email.svg"
                preserveColors
                className="size-9"
              />
              <div>
                <SheetTitle>Email notifications</SheetTitle>
                <SheetDescription>
                  Set up per form. Pick one to manage its recipients.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            <FormPicker
              onNavigate={() => setEmailOpen(false)}
              emptyLabel="You don't have any forms yet. Email notifications are set up on a form, so there's nothing to configure until there is one."
              forms={allForms.map((f) => {
                const configured = email.forms.find((e) => e.id === f.id);
                return {
                  ...f,
                  status: !configured
                    ? null
                    : configured.status === "on"
                      ? <OnPill />
                      : "Paused",
                };
              })}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Webhooks: per-form management list ── */}
      <Sheet open={webhookOpen} onOpenChange={setWebhookOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon
                src="/logo/webhook.svg"
                preserveColors
                className="size-9"
              />
              <div>
                <SheetTitle>Webhooks</SheetTitle>
                <SheetDescription>
                  Set up per form. Pick one to add or manage its endpoints.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            <FormPicker
              onNavigate={() => setWebhookOpen(false)}
              emptyLabel="You don't have any forms yet. Webhooks are set up on a form, so there's nothing to configure until there is one."
              forms={allForms.map((f) => {
                const configured = webhook.forms.find((w) => w.id === f.id);
                return {
                  ...f,
                  status: !configured ? null : (
                    // "2 of 3 active" rather than a bare count: a form can have
                    // several endpoints with some of them paused, and the
                    // difference is exactly what someone opening this panel to
                    // investigate a missing delivery is looking for.
                    <>
                      {configured.active > 0 ? (
                        <OnPill label={`${configured.active} of ${configured.total} active`} />
                      ) : (
                        `${configured.total} paused`
                      )}
                    </>
                  ),
                };
              })}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Discord: per-form management list ── */}
      <Sheet open={discordOpen} onOpenChange={setDiscordOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon
                src="/logo/discord.svg"
                preserveColors
                className="size-9"
              />
              <div>
                <SheetTitle>Discord</SheetTitle>
                <SheetDescription>
                  Set up per form. Pick one to manage its channel.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            <FormPicker
              onNavigate={() => setDiscordOpen(false)}
              emptyLabel="You don't have any forms yet. Discord posts are set up on a form, so there's nothing to configure until there is one."
              forms={allForms.map((f) => {
                const configured = discord.forms.find((d) => d.id === f.id);
                return {
                  ...f,
                  status: !configured
                    ? null
                    : configured.status === "on"
                      ? <OnPill />
                      : "Paused",
                };
              })}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Notion: per-form sync details (mirrors Google Sheets) ── */}
      <Sheet open={notionDetailsOpen} onOpenChange={setNotionDetailsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <SVGIcon
                src="/logo/notion.svg"
                preserveColors
                className="size-9"
              />
              <div>
                <SheetTitle>Notion</SheetTitle>
                <SheetDescription>
                  {notion.connection
                    ? `Connected to ${notion.connection.workspaceName}`
                    : "Not connected"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            <p className="text-sm text-muted-foreground">
              Every form sends new submissions to its own Notion database. A
              form&apos;s database is created on its first response, and new
              forms are added automatically.
            </p>

            <div className="mt-4 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Forms
              </h4>
              <span className="text-xs text-muted-foreground">
                {notion.forms.length} total
              </span>
            </div>

            {notion.forms.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No forms yet. New forms sync automatically once they receive a
                response.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {notion.forms.map((f) => {
                  const on = f.status === "syncing" || f.status === "pending";
                  return (
                    <li key={f.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {f.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <StatusBadge status={f.status} />
                          {f.databaseUrl ? (
                            <a
                              href={f.databaseUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              Open database
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
                                () => enableFormNotion(f.id),
                                `“${f.title}” will sync to Notion`
                              )
                            : run(
                                () => pauseFormNotion(f.id),
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
                  () => disconnectNotion(),
                  "Notion disconnected",
                  () => setNotionDetailsOpen(false)
                )
              }
            >
              <Icon name="logout" />
              Disconnect Notion
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
