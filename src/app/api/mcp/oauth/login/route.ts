/**
 * The Login URI the authorization server sends users to.
 *
 * THE HANDOFF, and the one thing to keep straight about it: authentication and
 * authorization are done by different parties here, on purpose.
 *
 * Supabase remains the only thing that ever sees a password. The authorization
 * server never becomes a second identity provider — a user who signed up with us
 * does not acquire a second account somewhere else, and an email change here does
 * not silently fork into two identities.
 *
 * So the AS, needing to know who is at the keyboard, redirects here. We check for
 * an existing session (sending the user through our own login if there is none),
 * then hand back our `users.id` as `external_auth_id`. The AS mints a token whose
 * `sub` is that id, which is why `grantForToken` can look the subject up directly
 * in `users` with no mapping table.
 *
 * WHAT THIS ROUTE MUST NOT DO. It must not decide anything. Every parameter here
 * arrives from a redirect a third party controls, so the only value it produces
 * is the id of the already-authenticated session — never anything read from the
 * query string. `state` is echoed back untouched because it belongs to the AS.
 */

import { redirect } from "next/navigation"
import { getOptionalUser } from "@/lib/auth/session"
import { isOauthConfigured } from "@/lib/mcp/oauth/config"

export async function GET(request: Request): Promise<Response> {
  if (!isOauthConfigured()) {
    return new Response("OAuth is not configured on this deployment", { status: 404 })
  }

  const url = new URL(request.url)

  // The AS tells us where to come back to. It is validated against the
  // configured issuer rather than trusted: an open redirect on a login route is
  // how a phishing page borrows our domain to look legitimate.
  const returnTo = url.searchParams.get("redirect_uri") ?? url.searchParams.get("return_to")
  const target = safeReturnTo(returnTo)
  if (!target) {
    return new Response("Invalid redirect target", { status: 400 })
  }

  const user = await getOptionalUser()
  if (!user) {
    // Not signed in. Send them through OUR login, with this URL as the
    // destination, so they come straight back here afterwards and the AS never
    // sees a credential.
    // `redirectTo` is the parameter LoginForm reads, and it accepts only
    // same-origin relative paths — so the round trip cannot be redirected off
    // our domain even though the AS chose where this flow started.
    const login = new URL("/auth/login", url.origin)
    login.searchParams.set("redirectTo", url.pathname + url.search)
    redirect(login.toString())
  }

  // The AS keys the user by this. It is our own id, so nothing new is minted and
  // the token's `sub` resolves directly against `users`.
  target.searchParams.set("external_auth_id", user.id)

  const state = url.searchParams.get("state")
  if (state) target.searchParams.set("state", state)

  redirect(target.toString())
}

/**
 * Only ever redirect back to the configured authorization server.
 *
 * A login route that redirects wherever it is told is an open redirect, and an
 * open redirect on the domain a user just typed their password into is worth
 * real money to a phisher. The issuer is the only destination this flow has any
 * reason to reach, so it is the only one allowed.
 */
function safeReturnTo(candidate: string | null): URL | null {
  if (!candidate) return null

  const issuer = process.env.MCP_OAUTH_ISSUER
  if (!issuer) return null

  let target: URL
  let allowed: URL
  try {
    target = new URL(candidate)
    allowed = new URL(issuer)
  } catch {
    return null
  }

  // Origin, not hostname: a downgrade to http on the right host is still a
  // downgrade, and a different port is a different server.
  return target.origin === allowed.origin ? target : null
}
