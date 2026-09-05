import "server-only"

/**
 * Append-only record of what each API key did.
 *
 * Records the tool and the row it touched — deliberately NEVER the arguments.
 * Tool arguments carry form content and, for submission tools, respondent
 * answers; an audit table is the last place that should accumulate, and it is
 * usually the longest-lived table in the system. "Which key called
 * makingflow_get_submission for submission X at time T" answers the questions a
 * data-protection request actually asks, without becoming a second copy of the
 * PII.
 *
 * Best-effort by design: a failed audit write must never fail the tool call it
 * describes. Losing an audit row is bad; failing a user's legitimate operation
 * because bookkeeping hiccuped is worse, and the alternative invites people to
 * disable auditing when it becomes flaky.
 */

import { db } from "@/lib/db"
import { mcpAuditLog } from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"

export type AuditStatus = "ok" | "denied" | "error"

export async function recordToolCall(input: {
  ctx: AuthContext
  tool: string
  /** The form/submission acted on, when the call names one. */
  targetId?: string | null
  status: AuditStatus
  durationMs: number
}): Promise<void> {
  try {
    await db.insert(mcpAuditLog).values({
      // Exactly one of these is set — see AuthContext.origin.
      keyId: input.ctx.apiKeyId,
      grantId: input.ctx.grantId,
      workspaceId: input.ctx.workspaceId,
      userId: input.ctx.userId,
      tool: input.tool,
      targetId: input.targetId ?? null,
      status: input.status,
      durationMs: input.durationMs,
    })
  } catch (error) {
    console.error("[mcp] audit write failed", error)
  }
}
