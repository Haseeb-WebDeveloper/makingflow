/**
 * Hostname normalization shared by the custom-domain proxy and the domain
 * server actions. Pure string logic, no imports — safe on the Edge runtime.
 */

/**
 * Reduce any host-ish input to a bare, comparable hostname: strips the scheme,
 * any path, the port and a trailing dot, then lowercases.
 *
 * `NEXT_PUBLIC_ROOT_DOMAIN` is easy to misconfigure as a full URL, so always
 * normalize it before comparing against a Host header. Splitting a raw
 * `https://example.com` on ":" yields `"https"`, which matches nothing and
 * silently makes our own domain look like a customer's custom domain.
 */
export function normalizeHost(input: string): string {
  let h = input.trim().toLowerCase()
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // drop any scheme
  h = h.split("/")[0] // drop any path
  h = h.split(":")[0] // drop any port
  return h.replace(/\.$/, "") // drop trailing dot
}
