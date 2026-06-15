import { getDefaultWorkspace } from '@/lib/auth/session'

/**
 * Role-based gates. Only the team-management and workspace-danger actions are
 * owner-gated; members keep full form/submission access, so we deliberately do
 * NOT sprinkle permission checks across the rest of the app.
 */

export type WorkspaceAction = 'manage_team' | 'delete_workspace'

// Actions only owners may perform. Anything not listed is allowed for any member.
const OWNER_ONLY: Record<WorkspaceAction, true> = {
  manage_team: true,
  delete_workspace: true,
}

export function can(role: string | undefined, action: WorkspaceAction): boolean {
  return OWNER_ONLY[action] ? role === 'owner' : true
}

export type ActiveWorkspace = {
  id: string
  name: string
  slug: string
  plan: string
  role: string
}

/**
 * Resolve the caller's active workspace and require the `owner` role. Returns
 * `{ workspace }` on success or `{ error }` so callers can return the standard
 * `{ success: false, error }` action shape without throwing.
 */
export async function requireOwner(): Promise<
  { workspace: ActiveWorkspace; error?: undefined } | { workspace?: undefined; error: string }
> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { error: 'No workspace' }
  if (!can(workspace.role, 'manage_team')) return { error: 'Only owners can do that' }
  return { workspace }
}
