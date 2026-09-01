/**
 * Cloudinary URL helpers that are safe to import from anywhere (no secrets, no
 * `server-only`) — the client needs `cldDeliver` to render, the server needs
 * `isCloudinaryUrl` to validate.
 */

/**
 * Inject Cloudinary delivery transforms (auto format/quality + a size cap) into
 * an upload URL so browsers download a small, modern (WebP/AVIF) image instead
 * of the full-resolution original. No-ops on non-Cloudinary URLs.
 */
export function cldDeliver(url: string, transform: string): string {
  const marker = "/image/upload/"
  const i = url.indexOf(marker)
  if (i === -1) return url
  // SVGs are vector — rasterizing them (f_auto / q_auto / resize) blurs them and
  // can crop. Serve the original so the logo/banner stays crisp at any size.
  if (/\.svg(\?|$)/i.test(url)) return url
  return `${url.slice(0, i + marker.length)}${transform}/${url.slice(i + marker.length)}`
}

/**
 * Is this a delivery URL for OUR Cloudinary account?
 *
 * Uploads go straight from the browser to an unsigned upload preset, so the URL
 * that comes back to a server action is attacker-controllable: whatever string
 * the client posts is what we would store and then render as an `<img src>` on
 * every page of every member of the workspace. This is the gate that stops that
 * from being an arbitrary URL.
 *
 * Deliberately NOT `isOurs()` from ./rehost.ts — that one is a substring test
 * used to classify already-rehosted assets, and `https://evil.test/?res.cloudinary.com`
 * satisfies it. Here we parse the URL and pin the host exactly, plus the cloud
 * name, so another tenant's Cloudinary account doesn't qualify either.
 *
 * Fails closed: unset cloud name (or any parse failure) returns false rather
 * than throwing, so a misconfigured environment rejects logos instead of
 * accepting anything.
 */
export function isCloudinaryUrl(url: string): boolean {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  if (!cloudName) return false
  // Bound the length before parsing — a stored URL ends up in every page's HTML.
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    if (parsed.host !== "res.cloudinary.com") return false
    return parsed.pathname.startsWith(`/${cloudName}/`)
  } catch {
    return false
  }
}
