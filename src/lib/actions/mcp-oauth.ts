"use server"

/**
 * Consent, and withdrawing it.
 *
 * This file is `"use server"`, so every export is a network-reachable endpoint
 * and the arguments are whatever a caller chose to send. Nothing here treats
 * them as trustworthy:
 *
 *   - the client and its redirect are re-resolved against the registration
 *     table, so approving cannot mint a code for a destination that was never
 *     registered — that is the open-redirect this whole subsystem is careful
 *     about, and a server action is just as reachable as the /authorize route
 *   - workspace ids are filtered against live membership inside `recordConsent`
 *   - scopes are filtered against the closed `Scope` union
 *
 * Approving is the moment the grant comes into existence AND the moment the
 * authorization code is issued, in that order. Doing both here rather than
 * bouncing back through /authorize keeps it to one round trip and means there
 * is no window where a grant exists but the user's browser has wandered off.
 */

import { revalidatePath } from "next/cache"
import { sessionContext } from "@/lib/auth/context-web"
import { isScope, type Scope } from "@/lib/auth/context"
import { recordConsent, revokeGrant } from "@/lib/mcp/oauth/grants"
import { revokeGrantTokens } from "@/lib/mcp/oauth/tokens"
import { resolveClientRedirect } from "@/lib/mcp/oauth/clients"
import { createAuthorizationCode, isValidCodeChallenge } from "@/lib/mcp/oauth/codes"

export type ConsentResult =
  | { success: true; redirectTo: string }
  | { success: false; error: string }

export async function approveConnection(input: {
  clientId: string
  redirectUri: string | null
  codeChallenge: string | null
  state: string | null
  resource: string | null
  scopes: string[]
  workspaceIds: string[]
}): Promise<ConsentResult> {
  const auth = await sessionContext("server-action")
  if (!auth.ok) return { success: false, error: auth.error }

  const scopes = input.scopes.filter(isScope) as Scope[]
  if (scopes.length === 0) return { success: false, error: "Choose at least one permission." }
  if (input.workspaceIds.length === 0) {
    return { success: false, error: "Choose at least one workspace." }
  }

  const resolved = await resolveClientRedirect(input.clientId, input.redirectUri)
  if (!resolved.ok) return { success: false, error: resolved.error }

  try {
    const { grantId } = await recordConsent({
      userId: auth.ctx.userId,
      clientId: resolved.client.id,
      // Snapshot of the name as it stood when the user agreed, so a client
      // renaming itself later cannot rewrite the record of what was consented.
      clientName: resolved.client.clientName,
      scopes,
      workspaceIds: [...new Set(input.workspaceIds)],
    })
    revalidatePath("/integrations")

    // Reached from /integrations rather than mid-flow — there is no
    // authorization to resume, so just show them the result.
    if (!isValidCodeChallenge(input.codeChallenge, "S256")) {
      return { success: true, redirectTo: "/integrations" }
    }

    const { code } = await createAuthorizationCode({
      grantId,
      clientId: resolved.client.id,
      redirectUri: resolved.redirectUri,
      codeChallenge: input.codeChallenge!,
      resource: input.resource,
    })

    const target = new URL(resolved.redirectUri)
    target.searchParams.set("code", code)
    // Echoed untouched: it is the client's CSRF protection, and a response
    // without it is discarded.
    if (input.state) target.searchParams.set("state", input.state)
    return { success: true, redirectTo: target.toString() }
  } catch (error) {
    console.error("[approveConnection] failed", error)
    return { success: false, error: "Couldn't save that. Please try again." }
  }
}

export async function disconnectApp(
  grantId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await sessionContext("server-action")
  if (!auth.ok) return { success: false, error: auth.error }

  const revoked = await revokeGrant(auth.ctx.userId, grantId)
  if (!revoked) return { success: false, error: "That connection no longer exists." }

  // The grant alone is enough — verification reads it on every request — but
  // killing the tokens too means nothing live is left pointing at it, and it is
  // what makes the audit trail read honestly.
  await revokeGrantTokens(grantId)

  revalidatePath("/integrations")
  return { success: true }
}
