/**
 * Validation for the post-submit redirect destination.
 *
 * WHY THIS IS NOT `checkOutboundUrl`: that guard protects OUR SERVER from
 * fetching a URL it shouldn't (SSRF), so it blocks loopback and private
 * ranges. Here nothing is fetched — the respondent's own browser navigates —
 * so a LAN or localhost destination is perfectly legitimate and must stay
 * allowed. What matters instead is the two ways `window.location` misbehaves:
 *
 *   1. A scheme-less value is resolved RELATIVE to the form page. A stored
 *      "example.com/thanks" sent respondents to /f/<publicId>/example.com/thanks
 *      — a 404, reached AFTER their answer was already recorded. Nobody
 *      notices, because the only place an owner tests is the builder preview,
 *      which disables redirecting on purpose.
 *   2. `javascript:` and `data:` EXECUTE. The form page is public, so an
 *      owner-authored destination runs in every respondent's browser.
 *
 * A bare host becomes https:// — the same courtesy `safeHref` does for the
 * builder's link box, because that is how people write addresses. Everything
 * else is refused at the point of storage rather than silently repaired.
 */

export type RedirectCheck = { ok: true; url: string } | { ok: false; error: string }

const RELATIVE_HINT = "Enter the full address, including https://."

/** What a typed redirect destination should be stored as, or why it is refused. */
export function normalizeRedirectUrl(raw: string): RedirectCheck {
  const v = raw.trim()
  if (!v) return { ok: false, error: "Enter a URL to send respondents to." }

  // An anchor or a path is the relative-resolution bug itself, so it is named
  // rather than lumped in with the dangerous schemes below.
  if (v.startsWith("/") || v.startsWith("#")) return { ok: false, error: RELATIVE_HINT }

  // Any scheme that is not http(s) — including javascript:, data:, mailto:
  // and tel:, none of which are somewhere a submit can send a browser.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return { ok: false, error: "Only http and https URLs are supported." }
  }

  let url: URL
  try {
    url = new URL(scheme ? v : `https://${v}`)
  } catch {
    return { ok: false, error: "That is not a valid URL." }
  }

  // No dot and not an IP literal — "f/abc" or a bare word, which would have
  // become a relative navigation had the https:// above not been added.
  const host = url.hostname.toLowerCase()
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, error: RELATIVE_HINT }
  }

  return { ok: true, url: url.toString() }
}

/**
 * The destination to hand a runtime, or null for "show the success screen".
 *
 * Rows written before the guard existed still hold raw values, so every read
 * re-checks rather than trusting the column — no migration needed, and a form
 * that was quietly 404-ing starts working the moment this ships. A repairable
 * value is repaired ("example.com/thanks" was always meant to be https://),
 * and anything refused falls back to the success screen: the response is
 * recorded either way, so a thank-you beats a 404 or a javascript: execution.
 */
export function usableRedirectUrl(stored: string | null): string | null {
  if (!stored) return null
  const res = normalizeRedirectUrl(stored)
  return res.ok ? res.url : null
}
