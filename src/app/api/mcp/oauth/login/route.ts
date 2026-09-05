/**
 * The Login URI the authorization server sends users to.
 *
 * THE HANDOFF. Authentication and authorization are done by different parties
 * here, on purpose. Supabase remains the only thing that ever sees a password:
 * the authorization server never becomes a second identity provider, so a user
 * does not acquire a second account somewhere else and an email change here does
 * not fork into two identities.
 *
 * The AS therefore redirects the user here carrying an `external_auth_id` — a
 * short-lived handle for one authorization request. We resolve who is at the
 * keyboard, then POST that handle back to the AS with our own `users.id`, and it
 * replies with where to send the user next.
 *
 * Note the direction: step three is a server-to-server POST authenticated with
 * our API key, NOT a redirect with the id appended. Getting that backwards
 * produces a flow that looks right and dead-ends at the AS. See ../authkit.ts.
 *
 * WHERE OUR CONSENT SCREEN FITS. The AS runs its own consent screen — "do you
 * allow this app?" — which is the question it can ask. It cannot ask ours:
 * WHICH WORKSPACES, and what the app may do in them. So we ask that here, before
 * completing, whenever we know which client is asking.
 *
 * We do not always know. The documented Login URI contract carries only
 * `external_auth_id`, so `client_id` is read opportunistically: present, we take
 * consent inline, which is the better experience; absent, the grant is created
 * on first use with no workspaces and the user finishes on /integrations. Both
 * paths end at the same row, and neither ever guesses which client is asking —
 * a grant bound to the wrong client would let one connected app act through
 * another's permissions.
 */

import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpOauthGrants } from "@/lib/db/schema"
import { getOptionalUser } from "@/lib/auth/session"
import { isOauthConfigured } from "@/lib/mcp/oauth/config"
import { completeAndRedirect } from "@/lib/mcp/oauth/complete"

export async function GET(request: Request): Promise<Response> {
  if (!isOauthConfigured()) {
    return new Response("App connections are not enabled on this deployment", { status: 404 })
  }

  const url = new URL(request.url)
  const externalAuthId = url.searchParams.get("external_auth_id")
  if (!externalAuthId) {
    return new Response("Missing external_auth_id", { status: 400 })
  }

  const user = await getOptionalUser()
  if (!user) {
    // Not signed in. Send them through OUR login with this URL as the
    // destination — `redirectTo` accepts only same-origin relative paths, so the
    // round trip cannot be aimed off our domain even though a third party chose
    // where this flow started.
    const login = new URL("/auth/login", url.origin)
    login.searchParams.set("redirectTo", url.pathname + url.search)
    redirect(login.toString())
  }

  // Opportunistic: the AS may or may not forward it. When it does, the user gets
  // to choose workspaces before the app is ever connected.
  const clientId = url.searchParams.get("client_id")
  const alreadyConsented = url.searchParams.get("consented") === "1"

  if (clientId && !alreadyConsented && !(await hasGrant(user.id, clientId))) {
    const consent = new URL("/oauth/consent", url.origin)
    consent.searchParams.set("client_id", clientId)
    consent.searchParams.set("external_auth_id", externalAuthId)
    const clientName = url.searchParams.get("client_name")
    if (clientName) consent.searchParams.set("client_name", clientName)
    redirect(consent.toString())
  }

  return completeAndRedirect(externalAuthId, user.id)
}

async function hasGrant(userId: string, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpOauthGrants.id })
    .from(mcpOauthGrants)
    .where(and(eq(mcpOauthGrants.userId, userId), eq(mcpOauthGrants.clientId, clientId)))
    .limit(1)
  return Boolean(row)
}
