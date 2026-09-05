/**
 * Dynamic Client Registration (RFC 7591).
 *
 * Unauthenticated, because that is the point: ChatGPT and claude.ai discover a
 * server and register on the spot, with no human to pre-arrange credentials
 * with. What a registration buys is an id and permission to ASK a user for
 * consent — never access. Access is a person ticking boxes on our consent
 * screen, recorded in mcp_oauth_grants.
 *
 * Parses JSON. Note the token endpoint parses form-urlencoded instead — that is
 * not an inconsistency, it is what the two specs say, and a server that uses one
 * parser for both returns 415 on half its own flow.
 *
 * No client secret is issued. These are public clients: the software runs on
 * someone else's servers or someone's laptop, so a shipped secret is a published
 * secret. PKCE does the job a secret would have done.
 */

import { registerClient } from "@/lib/mcp/oauth/clients"
import { MCP_CORS_HEADERS } from "@/lib/mcp/cors"

/** A registration body bigger than this is not a registration. */
const MAX_BODY_BYTES = 16 * 1024

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return error("invalid_client_metadata", "Registration document is too large.", 413)
  }

  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw || "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
    body = parsed as Record<string, unknown>
  } catch {
    return error("invalid_client_metadata", "Body must be a JSON object.", 400)
  }

  const result = await registerClient({
    clientName: body.client_name,
    clientUri: body.client_uri,
    redirectUris: body.redirect_uris,
  })
  if (!result.ok) {
    return error(result.error, result.description, 400)
  }

  const { client } = result
  return Response.json(
    {
      client_id: client.id,
      client_name: client.clientName ?? undefined,
      client_uri: client.clientUri ?? undefined,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Says out loud that there is no secret, so a client does not sit waiting
      // for one it will never receive.
      token_endpoint_auth_method: "none",
      // 0 means "does not expire". Registrations are cheap and carry no access;
      // expiring them would only break long-lived connections for no gain.
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
    },
    { status: 201, headers: MCP_CORS_HEADERS },
  )
}

function error(code: string, description: string, status: number): Response {
  return Response.json(
    { error: code, error_description: description },
    { status, headers: MCP_CORS_HEADERS },
  )
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}
