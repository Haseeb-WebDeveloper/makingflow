"use client";

import * as React from "react";
import type { FormSyncStatus } from "@/lib/data/integrations";

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

