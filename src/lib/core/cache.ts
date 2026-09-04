/**
 * Cache invalidation for core mutations.
 *
 * WHY THIS INDIRECTION EXISTS
 *
 * Next.js 16 gates tag invalidation on the calling surface:
 *
 *   - `updateTag(tag)` — Server Actions ONLY. Read-your-own-writes: the tag is
 *     expired immediately and the next read waits for fresh data. Calling it in
 *     a Route Handler throws outright.
 *   - `revalidateTag(tag, { expire: 0 })` — Server Actions AND Route Handlers.
 *     Next's docs name this as the pattern for "webhooks or third-party
 *     services that need immediate expiration ... when external systems call
 *     your Route Handlers", which is exactly what the MCP server is.
 *
 * Core functions are called from BOTH surfaces, so they cannot hardcode either.
 * They call `invalidate(ctx, ...)` and this dispatches on `ctx.surface`.
 *
 * `revalidatePath` needs no dispatch — it is valid in both — but it does behave
 * differently: in a Server Action it updates the UI immediately, while in a
 * Route Handler it only marks the path for revalidation on next visit. That is
 * the correct semantics for each: nobody is looking at a browser tab when an
 * MCP tool edits a form.
 *
 * The whole point of routing invalidation through core rather than the caller
 * is that a new MCP tool cannot forget it. Forgetting would leave the PUBLIC
 * form runtime serving a stale definition out of `form-public-*` with nothing
 * failing anywhere — a silent, respondent-visible bug.
 */

import { revalidatePath, revalidateTag, updateTag } from "next/cache"
import type { AuthContext } from "@/lib/auth/context"

export type Invalidation = {
  /** Cache tags set with `cacheTag()` in src/lib/data/**. */
  tags?: readonly string[]
  /** Dashboard routes whose rendered output is now out of date. */
  paths?: readonly (string | { path: string; type: "layout" | "page" })[]
}

export function invalidate(ctx: AuthContext, what: Invalidation): void {
  for (const tag of what.tags ?? []) {
    if (ctx.surface === "server-action") {
      updateTag(tag)
    } else {
      // expire: 0 — an MCP write must not leave the public form runtime
      // serving the old definition until some later visit happens to refresh it.
      revalidateTag(tag, { expire: 0 })
    }
  }

  for (const entry of what.paths ?? []) {
    if (typeof entry === "string") revalidatePath(entry)
    else revalidatePath(entry.path, entry.type)
  }
}
