/**
 * The public origin, read once and correctly.
 *
 * This exists because the MCP docs page got it wrong in three separate ways,
 * and the page is where we tell other people's developers which URL to point
 * their client at — so a wrong value here is a wrong value pasted into someone
 * else's config:
 *
 *   - it fell back to a Vercel preview host, while every other fallback in the
 *     app (`layout.tsx`, `sitemap.ts`, `robots.ts`) uses the real domain;
 *   - it never stripped a trailing slash, so `https://x.com/` yielded
 *     `https://x.com//api/mcp`;
 *   - it used `??`, which only catches `undefined` — an env var set to the
 *     empty string produced a bare `/api/mcp`, i.e. a relative path published
 *     as an absolute endpoint.
 *
 * `||` rather than `??` is the fix for the third: here an empty string is
 * exactly as unusable as a missing one.
 *
 * Safe to call from a cached or prerendered scope. `NEXT_PUBLIC_*` is inlined
 * by the compiler at build time, so this is a constant, not a runtime read, and
 * it does not opt a route out of static rendering.
 */

const FALLBACK = "https://makingflow.com"

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || FALLBACK
}

/** The MCP endpoint, as published in the docs and the discovery documents. */
export function mcpEndpoint(): string {
  return `${siteUrl()}/api/mcp`
}
