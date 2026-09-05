/**
 * The authorization endpoint.
 *
 * THE RULE THAT ORGANISES THIS FILE: an error is reported to the CLIENT, by
 * redirect, only once we are certain of where to send it. Before that — an
 * unknown `client_id`, a `redirect_uri` that matches nothing — the error is
 * shown to the USER, in the browser, because redirecting an unvalidated URI is
 * exactly the open redirect this endpoint must never be. Getting that ordering
 * backwards is how an authorization server becomes a code-stealing service.
 *
 * After validation the flow is:
 *
 *   not signed in  → our own login, and back here afterwards
 *   no consent yet → our consent screen, which asks which workspaces
 *   consented      → issue a code and redirect
 *
 * `state` is echoed back untouched on every path including errors — it is the
 * client's CSRF protection, and a response without it is discarded.
 */

import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpOauthGrants, mcpOauthGrantWorkspaces } from "@/lib/db/schema"
import { getOptionalUser } from "@/lib/auth/session"
import { resolveClientRedirect } from "@/lib/mcp/oauth/clients"
import { createAuthorizationCode, isValidCodeChallenge } from "@/lib/mcp/oauth/codes"
import { canonicalResource } from "@/lib/mcp/metadata"

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const params = url.searchParams
  const state = params.get("state")

  // ── Before anything is trusted: who is this, and where may they be sent? ──
  const resolved = await resolveClientRedirect(params.get("client_id"), params.get("redirect_uri"))
  if (!resolved.ok) {
    // Shown, not redirected. We have no verified destination yet.
    return userFacingError(resolved.error)
  }
  const { client, redirectUri } = resolved

  // From here on, errors go back to the client — it can act on them, and the
  // destination is one it registered.
  const fail = (error: string, description: string) =>
    redirectBack(redirectUri, { error, error_description: description, state })

  if (params.get("response_type") !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.")
  }

  const codeChallenge = params.get("code_challenge")
  if (!isValidCodeChallenge(codeChallenge, params.get("code_challenge_method"))) {
    // PKCE is mandatory in OAuth 2.1, and it is the only thing standing between
    // a leaked code and a stolen account for a client that holds no secret.
    return fail(
      "invalid_request",
      "PKCE is required: send code_challenge_method=S256 with a valid code_challenge.",
    )
  }

  // RFC 8707. Honoured when sent, and checked — a token bound to somebody
  // else's resource is not one we should be minting.
  const resource = params.get("resource")
  if (resource && resource !== canonicalResource(request)) {
    return fail("invalid_target", `This server only issues tokens for ${canonicalResource(request)}.`)
  }

  // ── Who is at the keyboard? ──
  const user = await getOptionalUser()
  if (!user) {
    // Our own login, then straight back here. `redirectTo` accepts only
    // same-origin relative paths, so the round trip cannot be aimed elsewhere.
    const login = new URL("/auth/login", url.origin)
    login.searchParams.set("redirectTo", url.pathname + url.search)
    redirect(login.toString())
  }

  // ── Have they already said what this app may reach? ──
  const grantId = await liveGrantId(user.id, client.id)
  if (!grantId) {
    // Our consent screen. Unlike a hosted authorization server, we know exactly
    // which client is asking, so it can ask the question that matters here:
    // which workspaces, and what may it do in them.
    const consent = new URL("/oauth/consent", url.origin)
    consent.searchParams.set("client_id", client.id)
    consent.searchParams.set("redirect_uri", redirectUri)
    consent.searchParams.set("code_challenge", codeChallenge!)
    if (state) consent.searchParams.set("state", state)
    if (resource) consent.searchParams.set("resource", resource)
    if (client.clientName) consent.searchParams.set("client_name", client.clientName)
    redirect(consent.toString())
  }

  const { code } = await createAuthorizationCode({
    grantId,
    clientId: client.id,
    redirectUri,
    codeChallenge: codeChallenge!,
    resource: resource ?? null,
  })

  redirect(buildRedirect(redirectUri, { code, state }).toString())
}

/**
 * The grant for this (user, client) if it is usable — present, not revoked, and
 * actually covering something. A grant reaching no workspace would issue a token
 * that can do nothing, so the user is sent back through consent instead.
 */
async function liveGrantId(userId: string, clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: mcpOauthGrants.id, revokedAt: mcpOauthGrants.revokedAt })
    .from(mcpOauthGrants)
    .where(and(eq(mcpOauthGrants.userId, userId), eq(mcpOauthGrants.clientId, clientId)))
    .limit(1)
  if (!row || row.revokedAt) return null

  const [scoped] = await db
    .select({ workspaceId: mcpOauthGrantWorkspaces.workspaceId })
    .from(mcpOauthGrantWorkspaces)
    .where(eq(mcpOauthGrantWorkspaces.grantId, row.id))
    .limit(1)
  return scoped ? row.id : null
}

function buildRedirect(base: string, params: Record<string, string | null>): URL {
  const target = new URL(base)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) target.searchParams.set(key, value)
  }
  return target
}

function redirectBack(base: string, params: Record<string, string | null>): never {
  redirect(buildRedirect(base, params).toString())
}

/**
 * An error the USER sees, because we have no verified place to send them.
 *
 * Plain text rather than a redirect, deliberately. This is the branch where a
 * redirect would be the vulnerability.
 */
function userFacingError(message: string): Response {
  return new Response(
    `Couldn't start that connection.\n\n${message}\n\nGo back to the app you were connecting and try again.`,
    { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
  )
}
