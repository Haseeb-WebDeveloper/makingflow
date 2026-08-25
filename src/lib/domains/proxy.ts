import { NextResponse, type NextRequest } from "next/server"

import { normalizeHost } from "./host"

/**
 * Custom-domain routing for proxy.ts. EDGE-SAFE: pure string logic, no DB, no
 * `server-only` import (middleware runs on the Edge runtime). The domain→form
 * lookup happens later in the /sites route's server component, NOT here — this
 * keeps the proxy under the CODING_GUIDE's 20ms / zero-network rule.
 *
 * On a custom host we rewrite page requests to /sites/{host}{path} and let the
 * /sites route resolve them. Framework + API traffic passes straight through.
 */

const ASSET_RE =
  /\.(png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff2?|json|txt|xml|webmanifest)$/

/** Is this host one of OUR hosts (app/marketing/preview/local) vs a customer's? */
function isPrimaryHost(host: string): boolean {
  const h = normalizeHost(host)
  if (h === "localhost" || h === "127.0.0.1") return true
  if (h.endsWith(".vercel.app")) return true // preview deployments

  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN
  if (!root) return true // feature off → treat everything as primary
  const r = normalizeHost(root)
  return h === r || h.endsWith(`.${r}`)
}

/**
 * Returns a rewrite/pass-through response for custom-domain requests, or null
 * for primary hosts (so the normal auth gate runs).
 */
export function rewriteCustomDomain(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host")
  if (!host || isPrimaryHost(host)) return null

  const { pathname } = request.nextUrl

  // Let framework + API + asset traffic serve normally on the custom host —
  // only page navigations get rewritten to the form resolver.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    ASSET_RE.test(pathname)
  ) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = `/sites/${normalizeHost(host)}${pathname}`
  return NextResponse.rewrite(url)
}
