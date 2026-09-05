/**
 * RFC 9728 Protected Resource Metadata — path-suffixed form.
 *
 * §3.1: a client whose resource identifier carries a path builds the metadata
 * URL by inserting that path after `.well-known`, so for
 * `https://…/api/mcp` it looks up
 * `/.well-known/oauth-protected-resource/api/mcp` — and tries that BEFORE the
 * root form. Serving only the root meant spec-strict clients got a 404 and
 * stopped. Claude recovered because our `WWW-Authenticate` names the root
 * explicitly, which is precisely why the gap went unnoticed.
 *
 * A catch-all rather than a literal `/api/mcp` segment, so any path a client
 * derives from a resource identifier we advertise resolves to the same
 * document. The document itself always describes the one canonical resource;
 * the path is only how the client found it.
 */

import { protectedResourceMetadata } from "@/lib/mcp/metadata"
import { MCP_CORS_HEADERS, preflight } from "@/lib/mcp/cors"

export function GET(request: Request): Response {
  return Response.json(protectedResourceMetadata(request), {
    headers: { ...MCP_CORS_HEADERS, "cache-control": "public, max-age=3600" },
  })
}

export function OPTIONS(request: Request): Response {
  return preflight(request)
}
