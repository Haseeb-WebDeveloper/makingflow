import "server-only"

/**
 * The RFC 9728 Protected Resource Metadata document.
 *
 * Served at TWO paths, which is not redundancy. §3.1 says a client whose
 * resource URL has a path (`/api/mcp`) constructs the metadata URL by inserting
 * that path after `.well-known`, i.e.
 * `/.well-known/oauth-protected-resource/api/mcp` — and tries that FIRST.
 * Only the root form was served, so a spec-strict client (MCP Inspector, VS
 * Code) got a 404 and gave up. Claude happens to fall back to the root because
 * our `WWW-Authenticate` names it explicitly, which is exactly why this went
 * unnoticed.
 *
 * Both paths return byte-identical JSON from this one function, so they cannot
 * drift apart later.
 */

import { SCOPES } from "@/lib/auth/context"

export function siteUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin
}

/** The canonical resource identifier. Must match what a client sends as
 *  `resource` byte for byte — no trailing slash, no fragment. */
export function canonicalResource(request: Request): string {
  return `${siteUrl(request)}/api/mcp`
}

export function protectedResourceMetadata(request: Request) {
  const base = siteUrl(request)

  return {
    resource: canonicalResource(request),
    // We are our own authorization server, so this is always our own origin —
    // no configuration to get wrong, and nothing that can be half-enabled. A
    // client reads this, fetches /.well-known/oauth-authorization-server there,
    // and has everything it needs.
    //
    // The resource server and the authorization server being one deployment is
    // also what lets the tokens be opaque: there is no arm's-length verification
    // to do, so there are no signing keys to publish, rotate, or misconfigure.
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SCOPES],
    resource_documentation: `${base}/docs/mcp`,
  }
}
