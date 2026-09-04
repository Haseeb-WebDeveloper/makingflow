import { getDefaultWorkspace, getWorkspaceMembership } from '@/lib/auth/session'
import type { WorkspaceContext } from '@/lib/auth/session'

/**
 * Role-based gates. Only the team-management and workspace-danger actions are
 * owner-gated; members keep full form/submission access, so we deliberately do
 * NOT sprinkle permission checks across the rest of the app.
 *
 * Note there is no `leave_workspace` action: leaving is member-ALLOWED and
 * owner-BLOCKED (a sole owner may not strand the workspace), which is the exact
 * inverse of the owner-only model here. That rule lives in `leaveWorkspace`.
 */

// The rules themselves live in ./roles.ts, which touches no request state, so
// that code needing only `can()` does not pull the session (and with it
// next/headers and next/navigation) in behind it. Re-exported here so every
// existing import path keeps working.
export { can, OWNER_ONLY, type WorkspaceAction } from '@/lib/auth/roles'
import { can } from '@/lib/auth/roles'
import type { WorkspaceAction } from '@/lib/auth/roles'

export type ActiveWorkspace = WorkspaceContext

type Gate =
  | { workspace: ActiveWorkspace; error?: undefined }
  | { workspace?: undefined; error: string }

/**
 * Resolve the caller's active workspace and require the `owner` role. Returns
 * `{ workspace }` on success or `{ error }` so callers can return the standard
 * `{ success: false, error }` action shape without throwing.
 */
export async function requireOwner(): Promise<Gate> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { error: 'No workspace' }
  if (!can(workspace.role, 'manage_team')) return { error: 'Only owners can do that' }
  return { workspace }
}

/**
 * Same shape as `requireOwner`, but for a workspace named explicitly by the
 * caller rather than whichever one is active. Actions that can target a
 * non-active workspace (delete, leave, logo from the workspaces list) must use
 * this — reading the active workspace instead would let a stale cookie decide
 * which tenant gets mutated.
 *
 * The generic 'No workspace' on a miss is deliberate: it must not distinguish
 * "doesn't exist" from "exists but isn't yours".
 */
export async function requireMember(workspaceId: string): Promise<Gate> {
  const workspace = await getWorkspaceMembership(workspaceId)
  if (!workspace) return { error: 'No workspace' }
  return { workspace }
}

/** `requireMember` plus a role check for the given action. */
export async function requireWorkspaceOwner(
  workspaceId: string,
  action: WorkspaceAction,
): Promise<Gate> {
  const gate = await requireMember(workspaceId)
  if (!gate.workspace) return gate
  if (!can(gate.workspace.role, action)) return { error: 'Only owners can do that' }
  return gate
}
