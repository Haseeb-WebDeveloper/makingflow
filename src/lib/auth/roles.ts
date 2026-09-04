/**
 * The role rules, as pure data and one pure function.
 *
 * Split out of ./permissions.ts because that module also holds the cookie-bound
 * gates, which reach `getDefaultWorkspace` → `getSession` → `next/headers` and
 * `next/navigation`. Anything importing the rules pulled the whole web stack in
 * behind them — which made `src/lib/auth/context.ts` only nominally
 * transport-agnostic, and made any non-Next entry point (a CLI script, a
 * one-off migration) fail on `next/navigation` for no reason.
 *
 * Nothing here touches a request. `permissions.ts` re-exports it all, so no
 * existing import path changed.
 */

export type WorkspaceAction = "manage_team" | "delete_workspace" | "update_workspace"

/**
 * Actions only owners may perform. Anything NOT listed is allowed for any
 * member — the app deliberately does not sprinkle permission checks across the
 * rest of the surface.
 */
export const OWNER_ONLY: Record<WorkspaceAction, true> = {
  manage_team: true,
  delete_workspace: true,
  // Name, slug, and logo — the workspace's identity to everyone in it.
  update_workspace: true,
}

export function can(role: string | undefined, action: WorkspaceAction): boolean {
  return OWNER_ONLY[action] ? role === "owner" : true
}
