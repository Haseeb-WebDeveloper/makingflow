/**
 * Share-link helpers shared by server (share page, builder data) and client
 * (publish dialog). No server-only deps — safe to import anywhere.
 */

/** Normalize free text into a URL path segment: "Job Application" → "job-application". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/**
 * The public URL for a form. When it's attached to an active custom domain with
 * a slug, that wins (team.acme.com/feedback); otherwise the default link
 * ({origin}/f/{publicId}).
 */
export function buildShareUrl(opts: {
  origin?: string
  publicId: string
  domain?: string | null
  slug?: string | null
}): string {
  if (opts.domain && opts.slug) return `https://${opts.domain}/${opts.slug}`
  const origin = opts.origin ?? ""
  return `${origin}/f/${opts.publicId}`
}
