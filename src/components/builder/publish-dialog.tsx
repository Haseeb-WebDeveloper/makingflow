"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Icon, type IconName } from "@/components/ui/icon"
import { FormSettings } from "@/components/forms/form-settings"
import { FormDomainPicker, type SetDomainResult } from "@/components/forms/domain-picker"
import type { FormSettingsData } from "@/lib/data/forms"

export function PublishDialog({
  open,
  onOpenChange,
  published,
  publishing,
  shareUrl,
  formId,
  formTitle,
  domains,
  domainId,
  slug,
  domainHost,
  onSetDomain,
  settings,
  formStatus,
  onPublish,
  onUnpublish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  published: boolean
  publishing: boolean
  shareUrl: string
  formId: string | null
  formTitle?: string
  domains?: { id: string; domain: string }[]
  domainId?: string | null
  slug?: string | null
  domainHost?: string | null
  onSetDomain?: (customDomainId: string | null, slug: string | null) => Promise<SetDomainResult>
  settings?: FormSettingsData | null
  formStatus?: string
  onPublish: () => void
  onUnpublish: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto w-fit">
        <DialogHeader>
          {published ? (
            <>
              <DialogTitle className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-success" />
                Your form is live
              </DialogTitle>
              <DialogDescription>Share this link to start collecting responses.</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>Publish your form</DialogTitle>
              <DialogDescription>
                Publishing makes your form live at a public link. Anyone with the link can respond —
                you can unpublish any time.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {published ? (
          <ShareLink shareUrl={shareUrl} formId={formId} onClose={() => onOpenChange(false)} />
        ) : (
          <ul className="space-y-2.5 py-1 text-sm text-muted-foreground">
            <InfoRow icon="discovery">Get a shareable public link</InfoRow>
            <InfoRow icon="folder">Start collecting responses instantly</InfoRow>
            <InfoRow icon="edit">Edits you make go live automatically</InfoRow>
          </ul>
        )}

        {domains && domains.length > 0 && onSetDomain ? (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Custom domain</h3>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              Serve this form from one of your connected domains — change or remove it anytime.
            </p>
            <FormDomainPicker
              domains={domains}
              domainId={domainId ?? null}
              slug={slug ?? null}
              domainHost={domainHost ?? null}
              formTitle={formTitle ?? ""}
              onApply={onSetDomain}
            />
          </section>
        ) : null}

        {formId && settings ? (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Form settings</h3>
            <FormSettings
              key={formStatus}
              formId={formId}
              initial={{ ...settings, status: formStatus ?? settings.status }}
            />
          </section>
        ) : null}

        <DialogFooter className={published ? "sm:justify-between" : undefined}>
          {published ? (
            <>
              <Button
                variant="ghost"
                onClick={onUnpublish}
                className="text-muted-foreground hover:text-foreground"
              >
                Unpublish
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <Button onClick={onPublish} disabled={publishing} className="w-full">
              {publishing ? "Publishing…" : "Publish form"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The live share link with copy/open + quick links into the manage tabs. */
function ShareLink({
  shareUrl,
  formId,
  onClose,
}: {
  shareUrl: string
  formId: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {shareUrl || "—"}
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Icon name={copied ? "tick-square" : "paper"} className="size-4" />
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={shareUrl || "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Icon name="login" className="size-4" />
          Open
        </a>
      </div>

      {formId ? (
        <div className="space-y-0.5 pt-1">
          <ManageLink
            href={`/forms/${formId}/share`}
            icon="discovery"
            label="Share & embed options"
            onNavigate={onClose}
          />
          <ManageLink
            href={`/forms/${formId}/submissions`}
            icon="folder"
            label="View submissions"
            onNavigate={onClose}
          />
        </div>
      ) : null}
    </div>
  )
}

function InfoRow({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-foreground">
        <Icon name={icon} className="size-4" />
      </span>
      {children}
    </li>
  )
}

function ManageLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string
  icon: IconName
  label: string
  onNavigate: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2.5">
        <Icon name={icon} className="size-4 text-muted-foreground" />
        {label}
      </span>
      <svg
        viewBox="0 0 24 24"
        className="size-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  )
}
