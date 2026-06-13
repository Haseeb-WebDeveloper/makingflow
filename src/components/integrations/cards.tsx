"use client"

import * as React from "react"
import { Switch } from "@/components/ui/switch"
import { Icon } from "@/components/ui/icon"
import type { FormSyncStatus } from "@/lib/data/integrations"

/** Recognizable Google Sheets brand tile (kept inline — no brand-icon pack). */
export function SheetsGlyph({ className = "size-9" }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-lg bg-[#0f9d58]/10 ${className}`}>
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path fill="#0f9d58" d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
        <path fill="#fff" d="M13 2v5h5z" opacity=".4" />
        <path
          fill="#fff"
          d="M8 11h8v6H8v-6Zm1.2 1.2v1.3h2.2v-1.3H9.2Zm3.4 0v1.3H15v-1.3h-2.4ZM9.2 14.7V16h2.2v-1.3H9.2Zm3.4 0V16H15v-1.3h-2.4Z"
        />
      </svg>
    </span>
  )
}

/** The shared card container — identical chrome on every integration card. */
export function CardShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col rounded-lg border border-border bg-card p-4">{children}</div>
}

const STATUS_LABEL: Record<FormSyncStatus, string> = {
  syncing: "Syncing",
  pending: "Pending first response",
  paused: "Paused",
  inactive: "Inactive",
}

export function StatusBadge({ status }: { status: FormSyncStatus }) {
  if (status === "syncing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        Syncing
      </span>
    )
  }
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {STATUS_LABEL[status]}
    </span>
  )
}

const COMING_SOON = [
  { name: "Webhooks", domain: "Send a POST on every submission" },
  { name: "Email", domain: "Notify your team of new responses" },
  { name: "Slack", domain: "Post submissions to a channel" },
  { name: "Notion", domain: "Append responses to a database" },
  { name: "Zapier", domain: "Connect to 5,000+ apps" },
] as const

/** The "coming soon" placeholder cards shared by both integration surfaces. */
export function ComingSoonCards() {
  return (
    <>
      {COMING_SOON.map((it) => (
        <CardShell key={it.name}>
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon name="swap" className="size-5" />
            </span>
            <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">{it.name}</h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">{it.domain}</p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Coming soon</span>
            <Switch checked={false} disabled />
          </div>
        </CardShell>
      ))}
    </>
  )
}
