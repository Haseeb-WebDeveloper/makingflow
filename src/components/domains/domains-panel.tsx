"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { addCustomDomain, checkCustomDomain, removeCustomDomain } from "@/lib/actions/domains"
import type { WorkspaceDomains, WorkspaceDomain } from "@/lib/data/domains"

function StatusBadge({ status }: { status: WorkspaceDomain["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        Active
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="rounded-full bg-destructive-bg px-2 py-0.5 text-[11px] font-medium text-destructive">
        Error
      </span>
    )
  }
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      Pending DNS
    </span>
  )
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground hover:text-primary"
      title="Copy"
    >
      <span className="truncate">{value}</span>
      <Icon name={copied ? "tick-square" : "paper"} className="size-3.5 shrink-0" />
    </button>
  )
}

function DnsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <CopyValue value={value} />
    </div>
  )
}

function DomainCard({
  domain,
  cnameTarget,
  pending,
  onCheck,
  onRemove,
}: {
  domain: WorkspaceDomain
  cnameTarget: string
  pending: boolean
  onCheck: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const subLabel = domain.domain.split(".")[0]

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{domain.domain}</span>
            <StatusBadge status={domain.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {domain.formsCount === 0
              ? "No forms published here yet"
              : `${domain.formsCount} form${domain.formsCount === 1 ? "" : "s"} published`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {domain.status !== "active" ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => onCheck(domain.id)}>
              <Icon name="time-circle" />
              Check status
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
            aria-label="Remove domain"
          >
            <Icon name="delete" />
          </Button>
        </div>
      </div>

      {domain.status !== "active" ? (
        <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Add this record at your DNS provider, then click <span className="font-medium">Check
            status</span>. SSL is issued automatically once it resolves.
          </p>
          <div className="mt-2 divide-y divide-border">
            <DnsRow label="Type" value="CNAME" />
            <DnsRow label="Name" value={subLabel} />
            <DnsRow label="Value" value={cnameTarget} />
          </div>
          {domain.verification.length > 0 ? (
            <div className="mt-2 border-t border-border pt-2">
              <p className="mb-1 text-xs text-muted-foreground">
                Ownership check — also add:
              </p>
              {domain.verification.map((v, i) => (
                <div key={i} className="divide-y divide-border">
                  <DnsRow label="Type" value={v.type.toUpperCase()} />
                  <DnsRow label="Name" value={v.domain} />
                  <DnsRow label="Value" value={v.value} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {domain.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              Forms published here will revert to their default <span className="font-mono">/f/…</span>{" "}
              links. You can re-add the domain later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onRemove(domain.id)
              }}
              disabled={pending}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              Remove domain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function DomainsPanel({ data }: { data: WorkspaceDomains }) {
  const router = useRouter()
  const [value, setValue] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  function onAdd() {
    const domain = value.trim()
    if (!domain) return
    startTransition(async () => {
      const res = await addCustomDomain(domain)
      if (res.success) {
        showToast("Domain added — configure DNS to finish", { type: "success" })
        setValue("")
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function onCheck(id: string) {
    startTransition(async () => {
      const res = await checkCustomDomain(id)
      if (res.success) {
        showToast("Status refreshed", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  function onRemove(id: string) {
    startTransition(async () => {
      const res = await removeCustomDomain(id)
      if (res.success) {
        showToast("Domain removed", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  if (!data.configured) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        <Icon name="info-square" className="mt-0.5 size-4 shrink-0" />
        <p>Custom domains aren&apos;t configured on this deployment yet. Check back soon.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-4">
        <label htmlFor="add-domain" className="text-sm font-medium text-foreground">
          Add a subdomain
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          e.g. <span className="font-mono">forms.yourbrand.com</span>. Your forms will be served at{" "}
          <span className="font-mono">{value.trim() || "forms.yourbrand.com"}/your-form</span>.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            id="add-domain"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd()
            }}
            placeholder="forms.yourbrand.com"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
          <Button onClick={onAdd} disabled={pending || !value.trim()}>
            <Icon name="plus" />
            Add domain
          </Button>
        </div>
      </div>

      {data.domains.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">No custom domains yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add a subdomain above to start serving forms from your own brand.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.domains.map((d) => (
            <DomainCard
              key={d.id}
              domain={d}
              cnameTarget={data.cnameTarget}
              pending={pending}
              onCheck={onCheck}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
