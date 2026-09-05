/**
 * The token endpoint: codes and refresh tokens in, access tokens out.
 *
 * PARSES FORM-URLENCODED, NOT JSON. RFC 6749 §4.1.3 is explicit, every real
 * client sends it that way, and a server that reaches for `request.json()` here
 * returns 415 to every one of them — after the rest of the flow appeared to
 * work perfectly. The registration endpoint next door parses JSON, because RFC
 * 7591 says so. Two specs, two parsers; that is not an inconsistency to tidy up.
 *
 * Every failure is `invalid_grant` with the same vague description. Telling a
 * caller whether the code was unknown, expired, issued to another client, or
 * simply verified against the wrong PKCE value would tell an attacker which
 * half of their guess was right.
 *
 * No caching, ever: the response contains credentials.
 */

import { redeemAuthorizationCode } from "@/lib/mcp/oauth/codes"
import { issueTokenPair, rotateRefreshToken } from "@/lib/mcp/oauth/tokens"
import { touchGrant } from "@/lib/mcp/oauth/grants"
import { MCP_CORS_HEADERS } from "@/lib/mcp/cors"

export async function POST(request: Request): Promise<Response> {
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await request.text())
  } catch {
    return error("invalid_request", "Body must be application/x-www-form-urlencoded.")
  }

  const grantType = form.get("grant_type")

  if (grantType === "authorization_code") return exchangeCode(form)
  if (grantType === "refresh_token") return refresh(form)

  return error(
    "unsupported_grant_type",
    "Supported grant types are authorization_code and refresh_token.",
  )
}

async function exchangeCode(form: URLSearchParams): Promise<Response> {
  const code = form.get("code")
  const clientId = form.get("client_id")
  const redirectUri = form.get("redirect_uri")
  const codeVerifier = form.get("code_verifier")

  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return error(
      "invalid_request",
      "code, client_id, redirect_uri and code_verifier are all required.",
    )
  }

  const redeemed = await redeemAuthorizationCode({ code, clientId, redirectUri, codeVerifier })
  if (!redeemed.ok) return error(redeemed.error, redeemed.description)

  const tokens = await issueTokenPair(redeemed.grant.grantId)
  await touchGrant(redeemed.grant.grantId)
  return success(tokens)
}

async function refresh(form: URLSearchParams): Promise<Response> {
  const refreshToken = form.get("refresh_token")
  if (!refreshToken) return error("invalid_request", "refresh_token is required.")

  // Rotates: the presented token is revoked and a new pair issued, so a stolen
  // one is good for a single use — and reusing an already-rotated token takes
  // the whole grant down, because that is what theft looks like.
  const rotated = await rotateRefreshToken(refreshToken)
  if (!rotated.ok) return error(rotated.error, rotated.description)

  await touchGrant(rotated.grantId)
  return success(rotated.tokens)
}

function success(tokens: {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
}): Response {
  return Response.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresInSeconds,
      refresh_token: tokens.refreshToken,
    },
    {
      headers: {
        ...MCP_CORS_HEADERS,
        // The body is a credential. It must not sit in a proxy or a disk cache.
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  )
}

function error(code: string, description: string): Response {
  return Response.json(
    { error: code, error_description: description },
    {
      // 400 for everything. `invalid_client` would conventionally be 401, but we
      // authenticate no clients here — they are public — so there is nothing to
      // challenge and a 401 would only invite a pointless retry with credentials.
      status: 400,
      headers: { ...MCP_CORS_HEADERS, "cache-control": "no-store" },
    },
  )
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}
