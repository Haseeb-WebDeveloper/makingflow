import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { forms, submissions } from '@/lib/db/schema'

/**
 * What a workspace would take with it if deleted.
 *
 * Shown in the delete confirmation, so deliberately NOT cached — someone about
 * to erase their responses should see the real number, not a minutes-old one.
 */
export async function getWorkspaceCounts(
  workspaceId: string,
): Promise<{ forms: number; submissions: number }> {
  const [formRow, submissionRow] = await Promise.all([
    db
      .select({ c: count() })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt))),
    db.select({ c: count() }).from(submissions).where(eq(submissions.workspaceId, workspaceId)),
  ])
  return { forms: formRow[0]?.c ?? 0, submissions: submissionRow[0]?.c ?? 0 }
}
