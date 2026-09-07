import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The three Settings pages, loading.
 *
 * Settings is mostly forms, and a form's labels are not data — "Display name",
 * "Email", "Password" and the section copy under them are fixed strings. Only
 * the values in the fields, and the lists of workspaces and members, come from
 * a query. So the forms draw themselves and the values wait.
 */

/** Account: the avatar and both field values wait; every label is real. */
export function AccountSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      </div>

      <div className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Skeleton className="h-9 w-full rounded-md" />
          <p className="text-xs text-muted-foreground">
            Your email is used to sign in and cannot be changed here.
          </p>
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <div>
        <h2 className="text-sm font-medium text-foreground">Password</h2>
        <Skeleton className="mt-2 h-3.5 w-72" />
        <Skeleton className="mt-3 h-9 w-36 rounded-md" />
      </div>
    </div>
  )
}

/**
 * Workspaces: heading, description and the create button are all static — the
 * only unknown is which workspaces you belong to.
 */
export function WorkspacesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Your workspaces
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Switch between workspaces or manage the active one&apos;s team.
          </p>
        </div>
        <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border p-4 last:border-0"
          >
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4" style={{ width: `${38 - i * 7}%` }} />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            <Skeleton className="size-8 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Workspace: the identity card is entirely workspace-specific, so it waits —
 * but the Team heading below it does not.
 */
export function WorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 shrink-0 rounded-lg" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground">Team</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          People who can build and manage forms in this workspace.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border p-4 last:border-0"
            >
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4" style={{ width: `${34 - i * 6}%` }} />
                <Skeleton className="h-3.5 w-48" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
