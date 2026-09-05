"use server"

/**
 * Consent, and withdrawing it.
 *
 * Thin wrappers over `@/lib/mcp/oauth/grants`, in the usual shape: this file is
 * `"use server"`, so every export is a network-reachable endpoint, and the
 * rule is that a wrapper resolves the caller and delegates without deciding
 * anything itself.
 *
 * The one thing worth stating plainly: the workspace ids arriving here come from
 * a form the browser posted, and a form is not a trust boundary. `recordConsent`
 * re-checks every one of them against live membership before writing, so a
 * tampered checkbox grants nothing.
 */

import { revalidatePath } from "next/cache"
import { sessionContext } from "@/lib/auth/context-web"
import { isScope, type Scope } from "@/lib/auth/context"
import { recordConsent, revokeGrant } from "@/lib/mcp/oauth/grants"

export type ConsentResult =
  | { success: true; grantId: string }
  | { success: false; error: string }

export async function approveConnection(input: {
  clientId: string
  clientName: string | null
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
  if (!input.clientId.trim()) return { success: false, error: "Missing client." }

  try {
    const { grantId } = await recordConsent({
      userId: auth.ctx.userId,
      clientId: input.clientId.trim(),
      // Untrusted display text supplied by the client at registration. Bounded
      // here so a long name cannot deform the "connected apps" list.
      clientName: input.clientName?.trim().slice(0, 120) || null,
      scopes,
      workspaceIds: [...new Set(input.workspaceIds)],
    })
    revalidatePath("/integrations")
    return { success: true, grantId }
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

  revalidatePath("/integrations")
  return { success: true }
}
