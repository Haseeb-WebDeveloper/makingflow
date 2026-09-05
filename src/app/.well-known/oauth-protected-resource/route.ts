/**
 * RFC 9728 Protected Resource Metadata — root form.
 *
 * The path-suffixed form lives at ./[...path]/route.ts and returns the same
 * document; see src/lib/mcp/metadata.ts for why both exist.
 *
 * Shipped now even though authentication is still API-key based. It makes the
 * 401 challenge honest — `/api/mcp` already returns
 * `WWW-Authenticate: Bearer resource_metadata="…"`, and a challenge pointing at
 * a 404 is worse than no challenge — and when OAuth lands, clients need no
 * change: only the contents of `authorization_servers` move.
 */

import { protectedResourceMetadata } from "@/lib/mcp/metadata"
import { MCP_CORS_HEADERS, preflight } from "@/lib/mcp/cors"

export function GET(request: Request): Response {
  return Response.json(protectedResourceMetadata(request), {
    headers: { ...MCP_CORS_HEADERS, "cache-control": "public, max-age=3600" },
  })
}

// Required, not optional: clients fetch this document cross-origin, so without
// preflight support discovery fails in a browser before it starts.
export function OPTIONS(request: Request): Response {
  return preflight(request)
}
