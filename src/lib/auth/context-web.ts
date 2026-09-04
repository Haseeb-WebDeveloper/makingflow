/**
 * The cookie-session producer: turns the browser's Supabase session into the
 * same `AuthContext` an API key produces, so `src/lib/core/**` never learns
 * which one it is serving.
 *
 * Lives in its own module rather than in ./session.ts for a testing reason.
 * Integration tests replace `@/lib/auth/session` WHOLESALE while exporting only
 * the one or two symbols the code under test happens to use (see
 * `tests/integration/export-route.test.ts` and `form-ai-thread.test.ts`). Any
 * symbol the mock omits comes back `undefined`. Keeping the producer separate
 * means a test can mock exactly this module — one symbol, no drift.
 *
 * CONSEQUENCE, AND IT IS LOAD-BEARING: `sessionContext` reaches for exactly two
 * symbols — `getOptionalUser()` and `getDefaultWorkspace()` — and adding a third
 * is a breaking change to every such mock. When migrating a module whose tests
 * mock the session, the mock must supply BOTH (today `export-route.test.ts`
 * supplies only `getDefaultWorkspace`), which is why each module's tests move in
 * the same commit as the module.
 */

import { redirect } from "next/navigation"
import { getDefaultWorkspace, getOptionalUser } from "@/lib/auth/session"
import {
  ALL_SCOPES,
  unsafeSealContext,
  type AuthContext,
  type ContextResult,
  type Role,
  type Surface,
} from "@/lib/auth/context"

/**
 * Resolve the signed-in caller. Costs no extra query — `getSession()` is
 * `cache()`d per request and already returns user, workspace, role and plan
 * from one joined read.
 *
 * A session carries ALL_SCOPES: it is the principal itself, not a credential
 * delegated on the principal's behalf. Role still gates everything role gated
 * before.
 */
export async function sessionContext(
  /**
   * Defaults to "server-action" because that is what almost every caller is.
   * A Route Handler resolving a cookie session (the CSV export route, say) must
   * pass "route-handler" explicitly — otherwise a mutation would try to call
   * `updateTag`, which throws outside a Server Action. See core/cache.ts.
   */
  surface: Surface = "server-action",
): Promise<ContextResult> {
  const [user, workspace] = await Promise.all([getOptionalUser(), getDefaultWorkspace()])
  if (!user) return { ok: false, error: "Not signed in" }
  if (!workspace) return { ok: false, error: "No workspace" }

  return {
    ok: true,
    ctx: unsafeSealContext({
      userId: user.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      role: workspace.role as Role,
      plan: workspace.plan,
      scopes: ALL_SCOPES,
      origin: "session",
      apiKeyId: null,
      surface,
    }),
  }
}

/**
 * For protected pages and layouts, which want the redirect rather than a result
 * to branch on. Server Actions should use `sessionContext()` and return
 * `{ success: false, error }` instead — a redirect thrown from an action is a
 * worse experience than an inline message.
 */
export async function requireSessionContext(): Promise<AuthContext> {
  const result = await sessionContext()
  if (!result.ok) redirect("/auth/login")
  return result.ctx
}
