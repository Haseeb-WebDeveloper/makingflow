/**
 * Folder operations, transport-agnostic.
 *
 * This is the pattern every other core module follows, so it is worth reading
 * once:
 *
 *   - `ctx: AuthContext` is the FIRST parameter and the ONLY source of tenancy.
 *     Nothing here asks who is calling; it is told. That is what lets the same
 *     function serve a browser Server Action and an MCP tool call.
 *   - Cache invalidation lives HERE, not in the caller, so a new MCP tool
 *     cannot forget it and leave the public form runtime serving a stale
 *     definition. It goes through `invalidate()` in src/lib/core/cache.ts
 *     rather than calling `updateTag` directly, because `updateTag` is
 *     Server-Action-only and core also runs inside a Route Handler.
 *   - Results are the codebase's usual discriminated union, never a throw.
 *
 * The thin `"use server"` wrappers in src/lib/actions/folders.ts keep their
 * original names and signatures, so no component changed.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { folders, forms } from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"

export type Result = { success: true } | { success: false; error: string }
export type CreateFolderResult =
  | { success: true; id: string }
  | { success: false; error: string }

function cleanName(name: string): string {
  return name.trim().slice(0, 100)
}

function invalidateFolderList(ctx: AuthContext) {
  invalidate(ctx, { tags: [`workspace-forms-${ctx.workspaceId}`], paths: ["/forms"] })
}

/** Create a folder in the caller's workspace. */
export async function createFolder(ctx: AuthContext, name: string): Promise<CreateFolderResult> {
  const clean = cleanName(name)
  if (!clean) return { success: false, error: "Enter a folder name." }

  const [created] = await db
    .insert(folders)
    .values({ workspaceId: ctx.workspaceId, name: clean })
    .returning({ id: folders.id })
  invalidateFolderList(ctx)
  return { success: true, id: created.id }
}

/** Rename a folder. Workspace-scoped. */
export async function renameFolder(
  ctx: AuthContext,
  folderId: string,
  name: string,
): Promise<Result> {
  const clean = cleanName(name)
  if (!clean) return { success: false, error: "Enter a folder name." }

  const result = await db
    .update(folders)
    .set({ name: clean })
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, ctx.workspaceId)))
    .returning({ id: folders.id })
  if (result.length === 0) return { success: false, error: "Folder not found" }
  invalidateFolderList(ctx)
  return { success: true }
}

/** Delete a folder; its forms fall back to Uncategorized (never deleted). */
export async function deleteFolder(ctx: AuthContext, folderId: string): Promise<Result> {
  // Un-file the folder's forms first (defensive — the FK is also set-null).
  await db
    .update(forms)
    .set({ folderId: null })
    .where(and(eq(forms.folderId, folderId), eq(forms.workspaceId, ctx.workspaceId)))
  const result = await db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, ctx.workspaceId)))
    .returning({ id: folders.id })
  if (result.length === 0) return { success: false, error: "Folder not found" }
  invalidateFolderList(ctx)
  return { success: true }
}

/** Move a form into a folder (or out of all folders when folderId is null). */
export async function moveFormToFolder(
  ctx: AuthContext,
  formId: string,
  folderId: string | null,
): Promise<Result> {
  // The target folder must belong to this workspace, or a form could be filed
  // into another tenant's folder.
  if (folderId) {
    const [folder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, ctx.workspaceId)))
      .limit(1)
    if (!folder) return { success: false, error: "Folder not found" }
  }

  const result = await db
    .update(forms)
    .set({ folderId })
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId)))
    .returning({ id: forms.id })
  if (result.length === 0) return { success: false, error: "Form not found" }
  invalidate(ctx, {
    tags: [
      `workspace-forms-${ctx.workspaceId}`,
      // The form's own cached reads (settings, shell) carry the folder now too.
      `form-${formId}`,
    ],
    paths: ["/forms"],
  })
  return { success: true }
}
