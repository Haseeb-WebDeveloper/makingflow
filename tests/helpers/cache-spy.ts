/**
 * Records the cache invalidations a core mutation performs.
 *
 * `updateTag`, `revalidateTag` and `revalidatePath` all require a Next request
 * scope and throw without one, so integration tests — which call core functions
 * directly — have to stub `next/cache` (see tests/setup-integration.ts, which
 * already does the same for `after()`).
 *
 * A plain no-op stub would work, but it would also make invalidation invisible
 * to tests, and forgetting to invalidate is the exact bug this refactor exists
 * to prevent: an MCP write that skips it leaves the PUBLIC form runtime serving
 * a stale definition with nothing failing anywhere. So the stub records instead,
 * and tests assert on what was invalidated.
 *
 * State hangs off globalThis because `vi.mock` factories are hoisted above
 * imports and cannot close over a module binding.
 */

export type CacheSpy = { tags: string[]; paths: string[] }

const KEY = "__mfCacheSpy" as const

type Global = typeof globalThis & { [KEY]?: CacheSpy }

export function cacheSpy(): CacheSpy {
  const g = globalThis as Global
  g[KEY] ??= { tags: [], paths: [] }
  return g[KEY]
}

export function resetCacheSpy(): void {
  const spy = cacheSpy()
  spy.tags.length = 0
  spy.paths.length = 0
}
