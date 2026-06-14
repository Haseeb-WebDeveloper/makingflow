"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import type { FormSyncStatus } from "@/lib/data/integrations";
import { SVGIcon } from "../ui/svg-icon";

/** The shared card container — identical chrome on every integration card. */
export function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg lg:rounded-[0.694vw] border border-border bg-card p-4 lg:p-[1.111vw]">
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
      <span className="inline-flex items-center gap-1 lg:gap-[0.278vw] rounded-full bg-success-bg px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium text-success-foreground">
        <span className="size-1.5 lg:size-[0.417vw] rounded-full bg-success" />
        Syncing
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium text-muted-foreground">
      {STATUS_LABEL[status]}
    </span>
  );
}

const COMING_SOON = [
  { name: "Discord", domain: "Post submissions to a channel", icon: "discord" },
  { name: "Notion", domain: "Append responses to a database", icon: "notion" },
  { name: "Zapier", domain: "Connect to 5,000+ apps", icon: "zapier" },
] as const;

/** The "coming soon" placeholder cards shared by both integration surfaces. */
export function ComingSoonCards() {
  return (
    <>
      {COMING_SOON.map((it) => (
        <CardShell key={it.name}>
          <div className="flex items-start justify-between gap-3 lg:gap-[0.833vw]">
            <SVGIcon
              src="/logo/webhook.svg"
              preserveColors
              className="size-9 lg:size-[2.5vw]"
            />
            <span className="shrink-0 rounded lg:rounded-[0.324vw] border border-border px-1.5 lg:px-[0.417vw] py-px text-[10px] lg:text-[0.694vw] font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          </div>
          <h3 className="mt-3 lg:mt-[0.833vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">
            {it.name}
          </h3>
          <p className="mt-1 lg:mt-[0.278vw] flex-1 text-sm lg:text-[0.972vw] text-muted-foreground">
            {it.domain}
          </p>
          <div className="mt-4 lg:mt-[1.111vw] flex items-center justify-between gap-3 lg:gap-[0.833vw] border-t border-border pt-3 lg:pt-[0.833vw]">
            <span className="text-xs lg:text-[0.833vw] text-muted-foreground">Coming soon</span>
            <Switch checked={false} disabled />
          </div>
        </CardShell>
      ))}
    </>
  );
}
