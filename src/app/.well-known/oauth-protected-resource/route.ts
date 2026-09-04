/**
 * RFC 9728 Protected Resource Metadata for the MCP endpoint.
 *
 * Shipped now even though v1 authenticates with a static API key rather than
 * OAuth. Two reasons:
 *
 *   1. It makes the 401 challenge honest. `/api/mcp` already returns
 *      `WWW-Authenticate: Bearer resource_metadata="…"`, and a challenge
 *      pointing at a 404 is worse than no challenge.
 *   2. When the OAuth phase lands, clients need no change: they already know
 *      where to look, and only the contents of `authorization_servers` move.
 *
 * `authorization_servers` is empty until then — which is the truth, not an
 * omission: there is no authorization server issuing tokens for this resource
 * yet.
 *
 * The OPTIONS handler is required, not optional: clients fetch this document
 * cross-origin, so without CORS preflight support discovery fails in a browser.
 */

function siteUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "access-control-max-age": "86400",
} as const

export function GET(request: Request): Response {
  const base = siteUrl(request)
  return Response.json(
    {
      // The canonical URI of the protected resource — must match the `resource`
      // a client sends, so no trailing slash and no fragment.
      resource: `${base}/api/mcp`,
      authorization_servers: [],
      bearer_methods_supported: ["header"],
      // The MINIMAL set for basic use. Anything beyond this is escalated
      // through a 403 step-up challenge rather than requested up front.
      scopes_supported: [
        "forms:read",
        "forms:write",
        "submissions:read",
        "submissions:write",
        "analytics:read",
        "integrations:write",
        "team:write",
        "destructive",
      ],
      resource_documentation: `${base}/docs/mcp`,
    },
    { headers: { ...CORS_HEADERS, "cache-control": "public, max-age=3600" } },
  )
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
