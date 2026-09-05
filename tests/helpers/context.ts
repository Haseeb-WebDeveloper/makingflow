/**
 * Build an AuthContext for tests.
 *
 * Core functions take their caller as an argument, so a test constructs one
 * directly instead of mocking `@/lib/auth/session`. That difference matters:
 * a module mock hands the code under test whatever the test decides, so a core
 * function that accidentally reached for ambient session state would be handed
 * the RIGHT answer and the test would pass while the MCP path was broken. With
 * a literal context there is no ambient state to fall back to — a core function
 * that ignores its `ctx` fails loudly.
 */

import {
  ALL_SCOPES,
  unsafeSealContext,
  type AuthContext,
  type Role,
  type Scope,
  type Surface,
} from "@/lib/auth/context"

export function testContext(overrides: {
  userId: string
  workspaceId: string
  workspaceName?: string
  role?: Role
  plan?: string
  scopes?: ReadonlySet<Scope>
  origin?: "session" | "api-key"
  apiKeyId?: string | null
  grantId?: string | null
  surface?: Surface
}): AuthContext {
  return unsafeSealContext({
    userId: overrides.userId,
    workspaceId: overrides.workspaceId,
    workspaceName: overrides.workspaceName ?? "Test workspace",
    role: overrides.role ?? "owner",
    plan: overrides.plan ?? "free",
    scopes: overrides.scopes ?? ALL_SCOPES,
    origin: overrides.origin ?? "session",
    apiKeyId: overrides.apiKeyId ?? null,
    grantId: overrides.grantId ?? null,
    // Tests run outside a Server Action, where updateTag() throws. The
    // route-handler path uses revalidateTag, which is valid here.
    surface: overrides.surface ?? "route-handler",
  })
}
