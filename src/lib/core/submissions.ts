/**
 * Owner-side submission operations, transport-agnostic.
 *
 * WHAT IS DELIBERATELY NOT HERE: `submitForm`. It stays in
 * src/lib/actions/submissions.ts and takes no AuthContext, because it is the
 * ANONYMOUS respondent path — there is no caller to resolve. It identifies its
 * form by `publicId`, rate-limits on the client IP and reads request headers
 * for device/country metadata, none of which a context could supply. Nobody
 * should "finish the job" by moving it here.
 *
 * These two are the opposite: owner-side, workspace-scoped, and reachable from
 * both the dashboard and an MCP tool.
 */

import { eq, inArray } from "drizzle-orm"
import { after } from "next/server"
import { db } from "@/lib/db"
import { submissions, uploads } from "@/lib/db/schema"
import { destroyAssets, resourceTypeFromMime } from "@/lib/cloudinary/delete"
import { deleteSubmissionFromSheet } from "@/lib/integrations/sync"
import { deleteSubmissionFromNotion } from "@/lib/integrations/notion-sync"
import { processSubmission } from "@/lib/ai/submission-intelligence"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"

export type Result = { success: true } | { success: false; error: string }

/**
 * Permanently delete a response and its answers (via cascade).
 *
 * Scoped on `submissions.workspaceId`, which is denormalized onto the row, so
 * the ownership check is one predicate and stays correct even while the parent
 * form is mid-delete. Every later statement keys off the row this returns.
 */
export async function deleteSubmission(
  ctx: AuthContext,
  submissionId: string,
): Promise<Result> {
  const [sub] = await db
    .select({
      id: submissions.id,
      formId: submissions.formId,
      workspaceId: submissions.workspaceId,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1)
  // Another tenant's response is indistinguishable from one that isn't there.
  if (!sub || sub.workspaceId !== ctx.workspaceId) {
    return { success: false, error: "Submission not found" }
  }

  // Capture the respondent's uploaded files BEFORE the delete so they can be
  // erased from Cloudinary (GDPR) — uploads.submissionId is set-null on delete,
  // so they would otherwise orphan with the asset still live.
  const uploadRows = await db
    .select({ id: uploads.id, storageKey: uploads.storageKey, mimeType: uploads.mimeType })
    .from(uploads)
    .where(eq(uploads.submissionId, sub.id))

  try {
    await db.delete(submissions).where(eq(submissions.id, sub.id))
    if (uploadRows.length > 0) {
      await db.delete(uploads).where(
        inArray(
          uploads.id,
          uploadRows.map((u) => u.id),
        ),
      )
    }
  } catch (err) {
    console.error("[deleteSubmission] failed", err)
    return { success: false, error: "Couldn't delete the response. Please try again." }
  }

  invalidate(ctx, {
    paths: [`/forms/${sub.formId}`, `/forms/${sub.formId}/submissions`],
  })

  // Off the request path — neither an integration outage nor a Cloudinary
  // failure may fail a delete that already committed in our database.
  after(async () => {
    await Promise.allSettled([
      deleteSubmissionFromSheet({ id: sub.formId, workspaceId: sub.workspaceId }, sub.id),
      deleteSubmissionFromNotion({ id: sub.formId, workspaceId: sub.workspaceId }, sub.id),
      destroyAssets(
        uploadRows.map((u) => ({
          publicId: u.storageKey,
          resourceType: resourceTypeFromMime(u.mimeType),
        })),
      ),
    ])
  })

  return { success: true }
}

/**
 * (Re)generate the AI summary/score for one response.
 *
 * Respects the form's opt-in flags and no-ops if neither summary nor screening
 * is enabled — this never turns on AI processing the owner didn't ask for.
 * `processSubmission` meters the calls itself.
 */
export async function generateSubmissionIntelligence(
  ctx: AuthContext,
  submissionId: string,
): Promise<Result> {
  const [sub] = await db
    .select({
      id: submissions.id,
      formId: submissions.formId,
      workspaceId: submissions.workspaceId,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1)
  if (!sub || sub.workspaceId !== ctx.workspaceId) {
    return { success: false, error: "Submission not found" }
  }

  const result = await processSubmission(sub.id)
  if (!result) {
    return {
      success: false,
      error: "Couldn't generate. Check that AI summary or screening is enabled.",
    }
  }

  invalidate(ctx, { paths: [`/forms/${sub.formId}/submissions`] })
  return { success: true }
}
