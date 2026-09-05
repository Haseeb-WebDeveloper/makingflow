import "server-only"

/**
 * CORS for the MCP endpoint and its discovery documents.
 *
 * These were missing entirely, which is a silent failure rather than a loud
 * one: a browser-based client's preflight returns 204 with no
 * `Access-Control-Allow-*` at all, the fetch throws an opaque TypeError, and
 * the client concludes the server does not speak the modern protocol and
 * quietly falls back to the legacy era — or gives up. Nothing in our logs
 * looks wrong, because from our side the preflight succeeded.
 *
 * The allow-list has to name the protocol's own headers. Every 2026-07-28 POST
 * carries `MCP-Protocol-Version`, `Mcp-Method` and, for tool calls,
 * `Mcp-Name`; `Mcp-Param-*` carries mirrored tool parameters. A header absent
 * from this list is stripped by the browser before the request is sent, so the
 * server sees a malformed request rather than a CORS error — which is a
 * genuinely confusing way to fail.
 *
 * `*` for the origin is correct here and is not a weakening: the endpoint is
 * authenticated by a bearer token, never by a cookie, so there are no ambient
 * credentials for another origin to borrow. `Access-Control-Allow-Credentials`
 * is deliberately absent for the same reason. DNS-rebinding protection is a
 * separate control and lives in the route's Origin/Host validation.
 */

const ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "MCP-Protocol-Version",
  "Mcp-Method",
  "Mcp-Name",
  "Mcp-Session-Id", // legacy-era clients still send it; harmless, we ignore it
  "Last-Event-ID",
].join(", ")

export const MCP_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": ALLOWED_HEADERS,
  // Lets a client read the protocol version off the response without a
  // preflight round-trip on every call.
  "access-control-expose-headers": "MCP-Protocol-Version, WWW-Authenticate",
  "access-control-max-age": "86400",
}

/**
 * Echo back any `Mcp-Param-*` headers the client asked for.
 *
 * The spec lets a tool mirror primitive parameters into headers so an
 * intermediary can route on them without parsing the body. The names are
 * per-tool and therefore unknowable up front, so a static allow-list cannot
 * cover them — reflect exactly what was requested, and nothing else.
 */
export function corsHeadersFor(request: Request): Record<string, string> {
  const requested = request.headers.get("access-control-request-headers")
  if (!requested) return MCP_CORS_HEADERS

  const mirrored = requested
    .split(",")
    .map((h) => h.trim())
    .filter((h) => /^mcp-param-[a-z0-9_-]+$/i.test(h))

  if (mirrored.length === 0) return MCP_CORS_HEADERS
  return {
    ...MCP_CORS_HEADERS,
    "access-control-allow-headers": `${ALLOWED_HEADERS}, ${mirrored.join(", ")}`,
  }
}

/** Preflight response. 204 with the headers, which is what was missing. */
export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) })
}

/** Add the CORS headers to a response the handler already produced. */
export function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeadersFor(request))) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
