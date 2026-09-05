/**
 * RFC 8414 authorization server metadata.
 *
 * The first thing a client fetches. Everything it does next is decided here, so
 * each field below is load-bearing rather than descriptive:
 *
 *   - `code_challenge_methods_supported: ["S256"]` — clients CHECK this before
 *     starting and refuse to proceed without it. Omitting it is a common reason
 *     a server "isn't supported" with no useful error.
 *   - `token_endpoint_auth_methods_supported: ["none"]` — we authenticate no
 *     clients here; they are public and PKCE does that job.
 *   - `grant_types_supported` must include `refresh_token`, or a client will
 *     re-run the whole consent flow every hour when its access token lapses.
 *
 * NOT advertised: `client_id_metadata_document_supported`.
 *
 * CIMD lets a client skip registration by using a URL as its `client_id`, which
 * the server then fetches. We do not implement that — `findClient` resolves a
 * uuid against our own table — so claiming it would send a client down a path
 * that dead-ends at "Unknown client" on the authorize step, AFTER discovery
 * appeared to succeed. Advertising a capability we lack is worse than lacking
 * it: clients pick their path from this document and do not retry the other one.
 *
 * Deliberately absent too: `plain` as a challenge method (removed in OAuth 2.1
 * and pointless — the challenge would be the verifier), and the implicit and
 * password grants (both removed, both bad).
 */

import { MCP_CORS_HEADERS } from "@/lib/mcp/cors"

function base(request: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin
}

export function GET(request: Request): Response {
  const origin = base(request)

  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,

      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],

      // RFC 8707. We honour the parameter and bind tokens to this resource.
      resource_indicators_supported: true,

      scopes_supported: [
        "forms:read",
        "forms:write",
        "submissions:read",
        "submissions:write",
        "analytics:read",
        "integrations:write",
        "team:write",
      ],
      service_documentation: `${origin}/docs/mcp`,
    },
    {
      headers: {
        ...MCP_CORS_HEADERS,
        // Clients cache discovery; a short window keeps a configuration change
        // from taking a day to reach them.
        "cache-control": "public, max-age=300",
      },
    },
  )
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}
