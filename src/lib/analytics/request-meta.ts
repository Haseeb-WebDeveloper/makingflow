import "server-only"
import { headers } from "next/headers"
import type { SubmissionMeta } from "@/lib/db/schema"

/** Coarse device class from a user-agent string. */
export function parseDevice(ua: string): NonNullable<SubmissionMeta["device"]> {
  const s = ua.toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(s) || (/android/.test(s) && !/mobile/.test(s))) {
    return "tablet"
  }
  if (
    /mobi|iphone|ipod|blackberry|opera mini|iemobile|windows phone/.test(s) ||
    (/android/.test(s) && /mobile/.test(s))
  ) {
    return "mobile"
  }
  return "desktop"
}

/**
 * Server-derived submission metadata: user-agent + device (parsed) and country
 * (from the platform's geo header — Vercel/Cloudflare set these; absent in
 * local dev). Referrer + UTM params come from the client instead, since the
 * server only sees the form page as referer.
 */
export async function getServerSubmissionMeta(): Promise<Partial<SubmissionMeta>> {
  try {
    const h = await headers()
    const ua = h.get("user-agent") || ""
    const country =
      h.get("x-vercel-ip-country") ||
      h.get("cf-ipcountry") ||
      h.get("x-country-code") ||
      ""
    const meta: Partial<SubmissionMeta> = {}
    if (ua) {
      meta.userAgent = ua.slice(0, 400)
      meta.device = parseDevice(ua)
    }
    if (country && country !== "XX") meta.country = country.toUpperCase().slice(0, 2)
    return meta
  } catch {
    return {}
  }
}
