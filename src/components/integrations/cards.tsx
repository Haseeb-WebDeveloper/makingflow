"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import type { FormSyncStatus } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

/** The shared card container — identical chrome on every integration card. */
export function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4">
      {children}
    </div>
  );
}

const STATUS_LABEL: Record<FormSyncStatus, string> = {
  syncing: "Syncing",
  pending: "Pending first response",
  paused: "Paused",
  inactive: "Inactive",
};

export function StatusBadge({ status }: { status: FormSyncStatus }) {
  if (status === "syncing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        Syncing
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {STATUS_LABEL[status]}
    </span>
  );
}

const COMING_SOON = [
  { name: "Notion", domain: "Append responses to a database", icon: "notion" },
] as const;

/** The "coming soon" placeholder cards shared by both integration surfaces. */
export function ComingSoonCards() {
  return (
    <>
      {COMING_SOON.map((it) => (
        <CardShell key={it.name}>
          <div className="flex items-start justify-between gap-3">
            <SVGIcon
              src={`/logo/${it.icon}.svg`}
              preserveColors
              className="size-9"
            />
            <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {it.name}
          </h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            {it.domain}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Coming soon</span>
            <Switch checked={false} disabled />
          </div>
        </CardShell>
      ))}
    </>
  );
}
