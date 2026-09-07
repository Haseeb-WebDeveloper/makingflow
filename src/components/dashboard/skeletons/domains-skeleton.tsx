import { Icon } from "@/components/ui/icon"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Domains, loading.
 *
 * THE ADD-A-DOMAIN CARD IS NOT DATA. It is a form — an icon, a heading, a
 * placeholder and a button — and none of it depends on the query. Rendering it
 * greyed out would hide the one thing a first-time visitor came to do behind a
 * spinner, for no reason. So it is drawn in full, only inert.
 *
 * Everything below it is the list of domains this workspace actually has,
 * which is the only part worth waiting for.
 */
export function DomainsSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <div className="max-w-xl rounded-xl border border-border bg-card p-5">
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
          {/* The real input and button, disabled rather than replaced — the
              shapes and the label are already correct, so there is nothing a
              grey box would communicate that this does not. */}
          <input
            disabled
            placeholder="forms.yourbrand.com"
            aria-hidden
            tabIndex={-1}
            className="h-9 w-full rounded-md border border-input bg-input/30 px-3 text-sm text-muted-foreground sm:flex-1"
          />
          <div className="flex h-10 shrink-0 items-center gap-2 rounded-md bg-foreground/40 px-4 text-sm text-background">
            <Icon name="plus" className="size-4" />
            Add domain
          </div>
        </div>

        <p className="mt-2.5 text-xs text-muted-foreground">
          Forms will be served at{" "}
          {/* The host is workspace-specific, so this one span waits. */}
          <Skeleton className="inline-block h-3.5 w-40 align-middle" />
          <span className="font-mono">/your-form</span>
        </p>
      </div>

      <ul className="space-y-3">
        {Array.from({ length: 2 }, (_, i) => (
          <li
            key={i}
            className="rounded-xl border border-border bg-card"
          >
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4" style={{ width: `${44 - i * 10}%` }} />
                <Skeleton className="h-3.5 w-32" />
              </div>
              <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
