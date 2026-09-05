/**
 * Token revocation (RFC 7009).
 *
 * ALWAYS RETURNS 200, including for a token that does not exist. The spec calls
 * for this and the reasoning is sound: a client revoking on sign-out cannot do
 * anything useful with a failure, and distinguishing "revoked" from "never
 * existed" would turn this into an oracle for testing stolen token guesses.
 *
 * Revoking a REFRESH token takes the whole grant with it — every access token
 * too. A client calling this is signing the user out, not tidying up one
 * credential, and leaving live access tokens behind would make the gesture a lie
 * for up to an hour.
 */

import { revokeToken } from "@/lib/mcp/oauth/tokens"
import { MCP_CORS_HEADERS } from "@/lib/mcp/cors"

export async function POST(request: Request): Promise<Response> {
  // Form-urlencoded, same as the token endpoint.
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await request.text())
  } catch {
    return ok()
  }

  const token = form.get("token")
  if (token) {
    try {
      await revokeToken(token)
    } catch (error) {
      // Logged, not surfaced: the caller has no recourse either way, and the
      // spec wants a 200.
      console.error("[mcp/oauth] revocation failed", error)
    }
  }

  return ok()
}

function ok(): Response {
  return new Response(null, {
    status: 200,
    headers: { ...MCP_CORS_HEADERS, "cache-control": "no-store" },
  })
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}
