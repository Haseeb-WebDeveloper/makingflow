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
import { oauthConfig } from "@/lib/mcp/oauth/config"

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
  const resource = canonicalResource(request)
  const oauth = oauthConfig(resource)

  return {
    resource,
    // Named only when an authorization server is actually configured. An empty
    // array is the honest answer for a deployment authenticating by API key
    // alone, and honesty matters here: a client that reads a non-empty
    // `authorization_servers` COMMITS to the OAuth flow and never falls back to
    // the header it would otherwise have used. Advertising an issuer that
    // cannot mint tokens for us therefore breaks clients that were working.
    authorization_servers: oauth ? [oauth.issuer] : ([] as string[]),
    bearer_methods_supported: ["header"],
    scopes_supported: [...SCOPES],
    resource_documentation: `${base}/docs/mcp`,
  }
}
