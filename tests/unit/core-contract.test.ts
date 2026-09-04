/**
 * The core layer's contract, asserted against its own source.
 *
 * ESLint already enforces most of this (see the `src/lib/core/**` blocks in
 * eslint.config.mjs), so why duplicate it? Because lint config is a file someone
 * can edit, and the thing being protected is multi-tenancy. A rule that lives
 * only in the linter disappears the moment a block is reordered — which already
 * happened once while building this: a later flat-config block silently replaced
 * the core import bans, and every one of them stopped firing while `pnpm lint`
 * still reported success. These assertions fail loudly in the test suite
 * instead.
 *
 * The rules, and why each one exists:
 *
 *  1. No `"use server"` / `"use cache"`. A `"use server"` core file would expose
 *     `ctx` as a client-supplied argument — an unauthenticated cross-tenant
 *     write (see src/lib/auth/context.ts).
 *  2. Every exported async function takes `ctx: AuthContext` first. That is the
 *     whole seam: core is told who is calling, it never asks.
 *  3. No ambient caller resolution. On a bearer-token request there is no
 *     cookie, so these would resolve to nothing — or, worse, to the wrong
 *     tenant.
 *  4. Every workspace predicate is keyed on `ctx.workspaceId`. This is the one
 *     that actually catches a leak: `eq(forms.workspaceId, someOtherId)` is a
 *     cross-tenant read that type-checks perfectly.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

const CORE_DIR = join(process.cwd(), "src", "lib", "core")

function coreFiles(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(coreFiles(full))
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

const FILES = coreFiles(CORE_DIR).map((path) => ({
  path,
  name: path.slice(CORE_DIR.length + 1).replace(/\\/g, "/"),
  source: readFileSync(path, "utf8"),
}))

/** Strip comments so a rule name mentioned in a doc comment isn't a violation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("core layer contract", () => {
  test("there is at least one core module to check", () => {
    // Guards against the whole suite silently passing on an empty directory.
    expect(FILES.length).toBeGreaterThan(0)
  })

  test.each(FILES)("$name declares no directive prologue", ({ source }) => {
    const code = stripComments(source)
    expect(code).not.toMatch(/^\s*["']use server["']/m)
    expect(code).not.toMatch(/^\s*["']use cache["']/m)
  })

  test.each(FILES)("$name takes ctx as the first parameter of every export", ({ source }) => {
    const code = stripComments(source)
    const offenders: string[] = []
    // Exported async functions only: exported types, consts and pure helpers
    // carry no tenancy and need no context.
    const fn = /export\s+async\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g
    for (const [, name, params] of code.matchAll(fn)) {
      const first = params.split(",")[0]?.trim() ?? ""
      if (!/^ctx\s*:\s*AuthContext\b/.test(first)) offenders.push(`${name}(${first || "—"})`)
    }
    expect(offenders).toEqual([])
  })

  test.each(FILES)("$name does not resolve the caller from ambient state", ({ source }) => {
    const code = stripComments(source)
    const banned = [
      "getRequiredUser",
      "getOptionalUser",
      "getDefaultWorkspace",
      "getMyWorkspaces",
      "getWorkspaceMembership",
      "requireOwner",
      "requireMember",
      "requireWorkspaceOwner",
      "sessionContext",
      "cookies(",
      "headers(",
      "redirect(",
    ]
    expect(banned.filter((token) => code.includes(token))).toEqual([])
  })

  test.each(FILES)("$name keys every workspace predicate on ctx.workspaceId", ({ source }) => {
    const code = stripComments(source)
    const offenders: string[] = []
    for (const [match, value] of code.matchAll(/eq\(\s*\w+\.workspaceId\s*,\s*([^)]+?)\s*\)/g)) {
      if (value.trim() !== "ctx.workspaceId") offenders.push(match)
    }
    expect(offenders).toEqual([])
  })
})
