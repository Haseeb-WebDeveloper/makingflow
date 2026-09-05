"use server"

/**
 * MCP API key Server Actions — the /integrations page's entry point.
 *
 * Thin: resolve the caller from the session cookie, delegate to
 * src/lib/core/mcp-keys.ts. The owner-only gate and the "you may only grant
 * workspaces you belong to" check live in core, so the CLI enforces them too.
 */

import { revalidatePath } from "next/cache"
import { sessionContext } from "@/lib/auth/context-web"
import * as keysCore from "@/lib/core/mcp-keys"

type Result = { success: true } | { success: false; error: string }

export async function createMcpKey(input: {
  name: string
  scopes: string[]
  workspaceIds: string[]
  expiresInDays?: number | null
}): Promise<keysCore.CreateKeyResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }

  const result = await keysCore.createKey(session.ctx, input)
  if (result.success) revalidatePath("/integrations")
  return result
}

export async function revokeMcpKey(keyId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }

  const result = await keysCore.revokeKey(session.ctx, keyId)
  if (result.success) revalidatePath("/integrations")
  return result
}
