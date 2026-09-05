/**
 * The MakingFlow MCP endpoint.
 *
 * Lets any MCP-capable AI client act on a workspace with the same authority its
 * owner has in the browser. Authenticated by a scoped API key
 * (`Authorization: Bearer mf_sk_live_…`).
 *
 * Shape follows MCP 2026-07-28, which is a STATELESS protocol: no `initialize`
 * handshake, no session id, no resumable streams. One POST endpoint, a fresh
 * server instance per request, and any instance can serve any request — which
 * is exactly what serverless wants.
 *
 * Order matters here. Origin/Host validation runs before authentication so a
 * hostile page cannot use a browser's ambient credentials; authentication runs
 * before rate limiting so the budget can be keyed to a real principal rather
 * than a shared egress IP.
 */

import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server"
import { after } from "next/server"
import { principalFromBearer, touchApiKey, unauthorized } from "@/lib/mcp/auth"
import { touchGrant } from "@/lib/mcp/oauth/grants"
import { buildServer } from "@/lib/mcp/server"
import { rateLimitApiKey, tooManyRequests } from "@/lib/mcp/rate-limit"
import { budgetFor, TOOLS_BY_NAME } from "@/lib/mcp/registry"
import { preflight, withCors } from "@/lib/mcp/cors"

// NOTE: no `export const runtime`. Under `cacheComponents` Next rejects the
// segment config outright ("not compatible with nextConfig.cacheComponents"),
// and it would be redundant anyway — Node is the default, which is what the
// postgres driver needs. No other route in this app declares one either.
//
// Sized for the slowest tool. AI-backed tools land later; publish already fans
// out to Sheets/Notion provisioning behind after().
export const maxDuration = 120

/** Absolute URL of our RFC 9728 metadata, for the WWW-Authenticate challenge. */
function resourceMetadataUrl(request: Request): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin
  return `${base}/.well-known/oauth-protected-resource`
}

/**
 * Hostnames this server answers on. Anything else is a rebinding attempt.
 *
 * HOSTNAMES, not `host:port` — the SDK validators compare the hostname alone,
 * so including a port here would reject every request.
 */
function allowedHostnames(request: Request): string[] {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  const names = [new URL(request.url).hostname]
  if (configured) names.push(new URL(configured).hostname)
  // Vercel serves each deployment on its own generated hostname as well as the
  // project domain; without this a preview deployment would refuse everything.
  if (process.env.VERCEL_URL) names.push(new URL(`https://${process.env.VERCEL_URL}`).hostname)
  return [...new Set(names)]
}

export async function POST(request: Request): Promise<Response> {
  // Neither Next.js nor the SDK handler does this for us, and the spec makes it
  // a MUST: an unvalidated Origin lets a malicious page in a victim's browser
  // drive this endpoint using whatever credentials the browser attaches.
  const rejected =
    hostHeaderValidationResponse(request, allowedHostnames(request)) ??
    originValidationResponse(request, allowedHostnames(request))
  if (rejected) return withCors(rejected, request)

  const auth = await principalFromBearer(request)
  if (!auth.ok) {
    if (auth.status === 403) {
      return withCors(
        Response.json({ error: "forbidden", error_description: auth.error }, { status: 403 }),
        request,
      )
    }
    // CORS matters most on the 401: it is the response that carries
    // `WWW-Authenticate`, and a browser client that cannot read that header
    // never discovers where to authenticate.
    return withCors(unauthorized(resourceMetadataUrl(request), ["forms:read"]), request)
  }

  const principal = auth.principal

  // Budgeted per key, in Postgres, so the limit holds across instances.
  //
  // Which budget depends on what is being called: a read is cheap, a write
  // touches the database and invalidates caches, and an AI-backed tool spends
  // real money. Charging everything to one bucket would let a client looping on
  // reads exhaust the AI budget. The tool name travels in the `Mcp-Name` header
  // precisely so an intermediary can see it without parsing the body; falling
  // back to "read" for anything unnamed keeps listing calls cheap.
  const toolName = request.headers.get("mcp-name")
  const tool = toolName ? TOOLS_BY_NAME.get(toolName) : undefined
  // Counted against the credential, whichever kind it is — an OAuth grant and
  // an API key are equally capable of looping, and a shared bucket would let
  // one tenant's connected app throttle another's.
  const credentialId =
    principal.credential.kind === "api-key"
      ? principal.credential.apiKeyId
      : principal.credential.grantId
  const limit = await rateLimitApiKey(credentialId, tool ? budgetFor(tool) : "read")
  if (!limit.ok) return withCors(tooManyRequests(limit.retryAfterSeconds), request)

  // Bookkeeping, off the response path — never fail a call over it.
  after(() =>
    principal.credential.kind === "api-key"
      ? touchApiKey(principal.credential.apiKeyId)
      : touchGrant(principal.credential.grantId),
  )

  const handler = createMcpHandler(() => buildServer(principal))
  try {
    return withCors(await handler.fetch(request), request)
  } finally {
    await handler.close()
  }
}

/**
 * Preflight. This was missing entirely — the endpoint answered OPTIONS with a
 * bare 204 and no `Access-Control-Allow-*`, so a browser-based client's
 * preflight "succeeded" while telling it nothing was permitted. The fetch then
 * failed with an opaque TypeError, which clients treat as "this server does not
 * speak the modern protocol" and silently downgrade.
 */
export function OPTIONS(request: Request): Response {
  return preflight(request)
}

/**
 * 2026-07-28 servers are POST-only. Answering 405 (rather than Next's default
 * 404) tells a client it reached the right URL with the wrong method, which is
 * how it distinguishes this from a missing endpoint.
 */
export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } })
}

export const DELETE = GET
