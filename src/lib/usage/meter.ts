import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaceUsage } from "@/lib/db/schema"

/** First day of the current UTC month as a `YYYY-MM-DD` string (the `date` key). */
function currentPeriodStart(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}

/**
 * Atomically add `n` to this workspace's AI-call counter for the current month.
 * One row per (workspace, month) — created on first call, incremented after.
 *
 * Best-effort: a metering failure must NEVER break a respondent's turn, so the
 * error is logged and swallowed. This is the first (and only) writer of
 * `workspace_usage.ai_calls_count`.
 */
export async function incrementAiCalls(workspaceId: string, n = 1): Promise<void> {
  if (n <= 0) return
  try {
    await db
      .insert(workspaceUsage)
      .values({ workspaceId, periodStart: currentPeriodStart(), aiCallsCount: n })
      .onConflictDoUpdate({
        target: [workspaceUsage.workspaceId, workspaceUsage.periodStart],
        set: {
          aiCallsCount: sql`${workspaceUsage.aiCallsCount} + ${n}`,
          updatedAt: new Date(),
        },
      })
  } catch (err) {
    console.error("[incrementAiCalls] failed", err)
  }
}
