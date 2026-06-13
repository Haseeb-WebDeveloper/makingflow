"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  addCustomDomain,
  checkCustomDomain,
  removeCustomDomain,
} from "@/lib/actions/domains";
import type { WorkspaceDomains, WorkspaceDomain } from "@/lib/data/domains";
import { SVGIcon } from "../ui/svg-icon";
import { Loading } from "../ui/loading";

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
      aria-hidden
    />
  );
}

function StatusPill({ status }: { status: WorkspaceDomain["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-[11px] font-medium text-success-foreground">
        <Icon name="tick-square" className="size-3.5" />
        Active
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-bg px-2.5 py-1 text-[11px] font-medium text-destructive">
        <Icon name="danger-triangle" className="size-3.5" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning/60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-warning" />
      </span>
      Awaiting DNS
    </span>
  );
}

/** A labeled DNS field with one-click copy + per-field "Copied" feedback. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          <Icon
            name={copied ? "tick-square" : "paper"}
            className={copied ? "text-success" : ""}
          />
        </Button>
      </div>
    </div>
  );
}

function DomainRow({
  domain,
  cnameTarget,
  busy,
  checking,
  onCheck,
  onRemove,
}: {
  domain: WorkspaceDomain;
  cnameTarget: string;
  busy: boolean;
  checking: boolean;
  onCheck: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const subLabel = domain.domain.split(".")[0];
  const active = domain.status === "active";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
              active
                ? "bg-success-bg text-success-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon name="discovery" className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {domain.domain}
              </span>
              <StatusPill status={domain.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {active ? (
                <>
                  Live ·{" "}
                  <span className="font-mono">
                    {domain.domain}/
                    <span className="text-muted-foreground/70">your-form</span>
                  </span>
                </>
              ) : (
                "Add the DNS record below to activate"
              )}
              {" · "}
              {domain.formsCount === 0
                ? "no forms yet"
                : `${domain.formsCount} form${
                    domain.formsCount === 1 ? "" : "s"
                  }`}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          aria-label="Remove domain"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Icon name="delete" />
        </Button>
      </div>

      {/* DNS setup (only while not active) */}
      {!active ? (
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Add this record at your DNS provider. We check automatically — SSL
              is issued once it resolves.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onCheck(domain.id)}
              className="shrink-0"
            >
              {checking ? <Spinner /> : <Icon name="time-circle" />}
              {checking ? "Checking…" : "Check now"}
            </Button>
          </div>

          <div className="mt-3 space-y-2 rounded-lg border border-border bg-card p-3">
            <CopyField label="Type" value="CNAME" />
            <CopyField label="Name" value={subLabel} />
            <CopyField label="Value" value={cnameTarget} />
          </div>

          {domain.verification.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Ownership check — also add:
              </p>
              {domain.verification.map((v, i) => (
                <div key={i} className="space-y-2">
                  <CopyField label="Type" value={v.type.toUpperCase()} />
                  <CopyField label="Name" value={v.domain} />
                  <CopyField label="Value" value={v.value} />
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
              Forms published here will revert to their default{" "}
              <span className="font-mono">/f/…</span> links. You can re-add the
              domain later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onRemove(domain.id);
              }}
              disabled={busy}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              Remove domain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function DomainsPanel({ data }: { data: WorkspaceDomains }) {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [, startTransition] = React.useTransition();

  const pendingIds = data.domains
    .filter((d) => d.status !== "active")
    .map((d) => d.id);
  const pendingKey = pendingIds.join(",");

  // Auto-detect activation: while any domain is pending, quietly re-check every
  // few seconds so it flips to Active on its own once DNS propagates. Pauses
  // when the tab is hidden; stops when nothing is pending.
  React.useEffect(() => {
    if (!pendingKey) return;
    let cancelled = false;
    const ids = pendingKey.split(",");
    const interval = setInterval(async () => {
      if (document.hidden || cancelled) return;
      for (const id of ids) {
        await checkCustomDomain(id);
        if (cancelled) return;
      }
      if (!cancelled) router.refresh();
    }, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingKey, router]);

  const preview = value.trim().toLowerCase() || "forms.yourbrand.com";
  const busy = adding || busyId !== null;

  function onAdd() {
    const domain = value.trim();
    if (!domain) return;
    setAdding(true);
    startTransition(async () => {
      const res = await addCustomDomain(domain);
      setAdding(false);
      if (res.success) {
        showToast("Domain added — set up DNS to finish", { type: "success" });
        setValue("");
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  function onCheck(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await checkCustomDomain(id);
      setBusyId(null);
      if (res.success) {
        showToast("Status refreshed", { type: "success" });
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  function onRemove(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await removeCustomDomain(id);
      setBusyId(null);
      if (res.success) {
        showToast("Domain removed", { type: "success" });
        router.refresh();
      } else {
        showToast(res.error, { type: "error" });
      }
    });
  }

  if (!data.configured) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        <Icon name="info-square" className="mt-0.5 size-4 shrink-0" />
        <p>
          Custom domains aren&apos;t configured on this deployment yet. Check
          back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add a domain */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon name="discovery" className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Add a subdomain
            </h2>
            <p className="text-xs text-muted-foreground">
              Use a subdomain like{" "}
              <span className="font-mono">forms.yourbrand.com</span>. Root
              domains aren&apos;t supported yet.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="add-domain"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            placeholder="forms.yourbrand.com"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
            className="sm:flex-1"
          />
          <Button
            onClick={onAdd}
            disabled={busy || !value.trim()}
            className="sm:shrink-0"
          >
            {adding ? (
              <Loading className="size-4" />
            ) : (
              <SVGIcon src="/icons/plus.svg" className="size-4" />
            )}
            Add domain
          </Button>
        </div>

        <p className="mt-2.5 text-xs text-muted-foreground">
          Forms will be served at{" "}
          <span className="font-mono text-foreground">{preview}</span>
          <span className="font-mono">/your-form</span>
        </p>
      </div>

      {/* Domain list */}
      {data.domains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon name="discovery" className="size-5" />
          </span>
          <p className="text-sm font-medium text-foreground">
            No custom domains yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add a subdomain above to serve your forms from your own brand.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              cnameTarget={data.cnameTarget}
              busy={busy}
              checking={busyId === d.id}
              onCheck={onCheck}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
