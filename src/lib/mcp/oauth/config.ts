import "server-only"

/**
 * Where the authorization server lives, and whether there is one at all.
 *
 * OAuth is OPTIONAL. A deployment with no authorization server configured keeps
 * working exactly as it does today — API keys, the connect flow on
 * /integrations, all 27 tools — and simply advertises no `authorization_servers`
 * in its discovery document. That is the honest answer for a self-hosted
 * install, and it means this whole subsystem can ship dark and be switched on
 * by setting two environment variables.
 *
 * The alternative — half-configuring OAuth and advertising an issuer that
 * cannot mint tokens — is worse than not offering it. A client that reads
 * `authorization_servers` commits to the OAuth flow and never falls back to the
 * header it would otherwise have used, so a broken issuer breaks clients that
 * were working.
 */

export type OauthConfig = {
  /** The authorization server's issuer URL, exactly as it appears in `iss`. */
  issuer: string
  /**
   * Who tokens must be minted FOR. RFC 8707: the client sends this as
   * `resource`, the AS puts it in `aud`, and we refuse anything else.
   *
   * This is the check that makes a hosted AS safe to share. Without it, a token
   * issued for ANY client registered on the same project would verify here —
   * the confused-deputy exposure the MCP spec exists to close, and the reason
   * Supabase's OAuth server was ruled out for this.
   */
  audience: string
  /** JWKS endpoint. Derived from the issuer unless overridden. */
  jwksUri: string
}

/**
 * Read the configuration, or null when OAuth is switched off.
 *
 * `MCP_OAUTH_ISSUER` alone turns it on; everything else has a sensible default.
 */
export function oauthConfig(canonicalResource: string): OauthConfig | null {
  const issuer = process.env.MCP_OAUTH_ISSUER?.replace(/\/$/, "")
  if (!issuer) return null

  return {
    issuer,
    // The resource identifier is ours, not the vendor's — it must match what a
    // client sends byte for byte, so it is derived from the request rather than
    // configured separately and left to drift.
    audience: canonicalResource,
    jwksUri: process.env.MCP_OAUTH_JWKS_URI ?? `${issuer}/oauth2/jwks`,
  }
}

/** True when this deployment can accept OAuth tokens at all. */
export function isOauthConfigured(): boolean {
  return Boolean(process.env.MCP_OAUTH_ISSUER)
}

/**
 * True when we can also COMPLETE an authorization, not merely verify a token.
 *
 * Separate from the above because the two halves fail differently. Without an
 * issuer we cannot verify anything and should advertise no OAuth at all;
 * without an API key we can verify tokens perfectly well but the Login URI
 * cannot hand identity back, so users get stuck mid-connect. Distinguishing
 * them turns a mystifying dead end into a message naming the missing variable.
 */
export function canCompleteAuthorization(): boolean {
  return isOauthConfigured() && Boolean(process.env.WORKOS_API_KEY)
}
