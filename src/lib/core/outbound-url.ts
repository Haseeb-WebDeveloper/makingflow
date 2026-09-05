/**
 * Validation for URLs the server will later fetch on a user's behalf.
 *
 * WHY THIS EXISTS NOW, when the old check (protocol is http or https, that's
 * it) was fine for years: the person entering a webhook URL used to be a human
 * with a browser session, typing their own endpoint. Once an MCP tool can set
 * one, the caller is a model that can be talked into things, and
 * `send_test_webhook` returns the HTTP status of whatever it hit — which turns
 * "add a webhook and test it" into a working SSRF probe of anything our server
 * can reach. Cloud metadata endpoints, internal admin panels, databases bound
 * to localhost.
 *
 * So this blocks the destinations that are never a legitimate customer webhook:
 * loopback, private ranges, link-local (including the 169.254.169.254 metadata
 * address), and unqualified hostnames.
 *
 * WHAT THIS IS NOT: complete SSRF protection. A hostname that resolves to a
 * private address at connect time defeats it, because we validate the literal
 * and the resolver runs later — the classic DNS-rebinding gap. Closing that
 * properly means resolving and pinning the address, or an egress proxy. This
 * raises the floor from "trivial" to "requires effort", and is applied at the
 * point the URL is stored so a blocked destination can never be saved, let
 * alone called.
 */

/** Reserved IPv4 ranges that a customer webhook is never legitimately on. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".")
  if (parts.length !== 4) return false
  const octets = parts.map((p) => Number(p))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false

  const [a, b] = octets
  return (
    a === 0 || // "this network"
    a === 10 || // 10/8 private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 carrier NAT
    (a === 169 && b === 254) || // link-local — includes 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) || // 192.168/16 private
    (a === 192 && b === 0) || // 192.0.0/24 + 192.0.2/24 documentation
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    a >= 224 // multicast and reserved
  )
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  return (
    h === "::1" || // loopback
    h === "::" || // unspecified
    h.startsWith("fc") || // fc00::/7 unique local
    h.startsWith("fd") ||
    h.startsWith("fe80") || // link-local
    h.startsWith("::ffff:") // IPv4-mapped — would otherwise bypass the v4 checks
  )
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"])

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string }

/**
 * Normalise a user-supplied destination URL, rejecting anything that points
 * back at our own infrastructure.
 */
export function checkOutboundUrl(input: string): UrlCheck {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: "Enter a valid http(s) URL." }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are supported." }
  }

  const host = url.hostname.toLowerCase()

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, error: "That address is not reachable from our servers." }
  }
  // No dot and not an IP literal — an internal short name like `intranet`.
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, error: "Enter a fully qualified public hostname." }
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, error: "That address is not reachable from our servers." }
  }

  return { ok: true, url: url.toString() }
}
