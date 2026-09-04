/**
 * Ownership checks for tenant-scoped rows.
 *
 * THE RULE THESE EXIST TO ENFORCE: a core function's first statement resolves
 * the target row through one of these, and every later statement uses ids taken
 * from THAT ROW — never from the function's arguments.
 *
 * The reason is a real hazard already present in the pre-refactor code.
 * `deleteForm` scoped its ownership SELECT to the workspace, then issued
 * `db.delete(forms).where(eq(forms.id, formId))` and three asset-gathering reads
 * keyed on `formId` alone. Correct — but only because the scoped SELECT happened
 * to run first. Reorder those statements, or add an early return between them,
 * and the guard evaporates silently, with nothing failing until another tenant's
 * form is deleted. Deriving later ids from the checked row makes the ordering
 * irrelevant instead of load-bearing.
 *
 * These return the WHOLE row rather than a projection. One row, once per
 * operation, in exchange for callers never needing a second unscoped read to
 * pick up a column the check didn't select — which is the very shape the rule
 * above exists to prevent.
 *
 * A row belonging to another tenant is indistinguishable from one that does not
 * exist. That is deliberate and matches the rest of the app: the caller learns
 * "not found" either way, so the API never confirms the existence of something
 * they may not see.
 */

import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { folders, forms, submissions } from "@/lib/db/schema"
import type { Folder, Form, Submission } from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"

/** What every helper here returns: the row, or the reason to hand the caller. */
export type Owned<T> = { ok: true; row: T } | { ok: false; error: string }

/** Resolve a form the caller's workspace owns. Soft-deleted forms do not count. */
export async function assertOwnedForm(
  ctx: AuthContext,
  formId: string,
): Promise<Owned<Form>> {
  const [row] = await db
    .select()
    .from(forms)
    .where(
      and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId), isNull(forms.deletedAt)),
    )
    .limit(1)
  return row ? { ok: true, row } : { ok: false, error: "Form not found" }
}

/** Resolve a folder the caller's workspace owns. */
export async function assertOwnedFolder(
  ctx: AuthContext,
  folderId: string,
): Promise<Owned<Folder>> {
  const [row] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, ctx.workspaceId)))
    .limit(1)
  return row ? { ok: true, row } : { ok: false, error: "Folder not found" }
}

/**
 * Resolve a submission the caller's workspace owns.
 *
 * Scoped on `submissions.workspaceId` (denormalized onto the row) rather than
 * joining through `forms` — one predicate, and it stays correct even while a
 * form row is mid-delete.
 */
export async function assertOwnedSubmission(
  ctx: AuthContext,
  submissionId: string,
): Promise<Owned<Submission>> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), eq(submissions.workspaceId, ctx.workspaceId)))
    .limit(1)
  return row ? { ok: true, row } : { ok: false, error: "Submission not found" }
}
