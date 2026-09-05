import "server-only"

/**
 * The authorization server's completion API.
 *
 * Standalone Connect runs the handshake in a direction that is easy to get
 * backwards, so it is worth stating exactly:
 *
 *   1. The client starts at the AS's `/oauth2/authorize`.
 *   2. The AS redirects the user to OUR Login URI, carrying an
 *      `external_auth_id` — a short-lived handle for this one authorization.
 *   3. We authenticate the user however we like (Supabase, here) and then POST
 *      that handle BACK to the AS with the identity we resolved.
 *   4. The AS replies with a `redirect_uri`. We send the user there, it shows
 *      its own consent screen, and it takes over again.
 *
 * The mistake to avoid is thinking step 3 is a redirect with `external_auth_id`
 * appended. It is a server-to-server POST authenticated with our API key, and
 * the redirect target comes back in the response — inventing one produces a
 * flow that looks right and dead-ends at the AS.
 *
 * WHY THIS DIRECTION IS BETTER FOR US. The identity crosses over on a
 * back channel, authenticated with a secret only we hold, rather than in a URL
 * the browser can see and edit. `user.id` is our own `users.id`, which is what
 * lets `grantForToken` resolve a token's `sub` directly against `users` with no
 * mapping table.
 */

import { isOauthConfigured } from "@/lib/mcp/oauth/config"

export type CompletionIdentity = {
  /** Our own `users.id`. Becomes the token's `sub`. */
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export type CompletionResult =
  | { ok: true; redirectUri: string }
  | { ok: false; error: string }

function completionEndpoint(): string {
  return (
    process.env.WORKOS_COMPLETION_URL ?? "https://api.workos.com/authkit/oauth2/complete"
  )
}

/**
 * Hand the authenticated identity back to the authorization server.
 *
 * Returns where to send the user next. Every failure is reported rather than
 * thrown: this runs inside a redirect handler, and an unhandled throw there
 * shows the user a 500 in the middle of connecting an app, with no clue what
 * went wrong or whether to retry.
 */
export async function completeAuthorization(
  externalAuthId: string,
  user: CompletionIdentity,
): Promise<CompletionResult> {
  const apiKey = process.env.WORKOS_API_KEY
  if (!apiKey || !isOauthConfigured()) {
    return { ok: false, error: "App connections are not configured on this deployment." }
  }

  let response: Response
  try {
    response = await fetch(completionEndpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        external_auth_id: externalAuthId,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.firstName ?? undefined,
          last_name: user.lastName ?? undefined,
        },
      }),
      // A hung authorization server must not hold the user on a blank page.
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.error("[mcp/oauth] completion request failed", error)
    return { ok: false, error: "Couldn't reach the authorization service. Please try again." }
  }

  if (!response.ok) {
    // The body may carry the AS's own diagnosis, which is worth logging — but
    // not worth showing, since it is written for us and not for the user.
    console.error(
      "[mcp/oauth] completion rejected",
      response.status,
      await response.text().catch(() => ""),
    )
    return {
      ok: false,
      // An expired handle is the common case and the only one the user can act
      // on, so the message points at the fix rather than at the status code.
      error:
        response.status === 400 || response.status === 404
          ? "That connection request has expired. Start again from the app you're connecting."
          : "The authorization service rejected the request. Please try again.",
    }
  }

  const body = (await response.json().catch(() => null)) as { redirect_uri?: string } | null
  if (!body?.redirect_uri) {
    console.error("[mcp/oauth] completion returned no redirect_uri", body)
    return { ok: false, error: "The authorization service returned an unexpected response." }
  }

  return { ok: true, redirectUri: body.redirect_uri }
}
