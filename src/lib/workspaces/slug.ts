/**
 * Workspace slug generation.
 *
 * `workspaces.slug` is display-only (shown under the name in Settings — nothing
 * routes or looks up on it), but it carries a unique index, so every write has
 * to cope with a collision. The random suffix makes one vanishingly unlikely;
 * `isUniqueViolation` lets callers retry rather than throw a raw Postgres error
 * out of a server action when it happens anyway.
 */

import { slugify } from "@/lib/forms/share"

/** Slug for a workspace name: normalized, capped, plus a short random suffix. */
export function workspaceSlug(name: string): string {
  // `slugify` caps at 60 for form share links; workspace slugs have always been
  // 32, and shortening here keeps existing slugs and new ones the same shape.
  const base = slugify(name).slice(0, 32) || "workspace"
  return `${base}-${crypto.randomUUID().slice(0, 6)}`
}

/** Postgres unique-constraint violation (23505) — the caller should retry. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  // postgres-js puts the SQLSTATE on `code`; some wrappers nest the driver
  // error under `cause`.
  const code = (err as { code?: unknown }).code
  if (code === "23505") return true
  const cause = (err as { cause?: unknown }).cause
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "23505"
  )
}

/**
 * Run a slug-consuming write, regenerating the slug if the unique index rejects
 * it. Three attempts: with a 6-hex suffix, a second collision is already beyond
 * unlikely, and retrying forever would turn a real bug into a hang.
 */
export async function withSlugRetry<T>(
  name: string,
  write: (slug: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await write(workspaceSlug(name))
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      lastErr = err
      console.error(`[workspaceSlug] collision on attempt ${attempt + 1}`, err)
    }
  }
  throw lastErr
}
