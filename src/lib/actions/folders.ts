"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { db } from "@/lib/db"
import { folders, forms } from "@/lib/db/schema"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"

type Result = { success: true } | { success: false; error: string }

function cleanName(name: string): string {
  return name.trim().slice(0, 100)
}

function invalidate(workspaceId: string) {
  updateTag(`workspace-forms-${workspaceId}`)
  revalidatePath("/forms")
}

/** Create a folder in the active workspace. */
export async function createFolder(
  name: string,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }
  const clean = cleanName(name)
  if (!clean) return { success: false, error: "Enter a folder name." }

  const [created] = await db
    .insert(folders)
    .values({ workspaceId: workspace.id, name: clean })
    .returning({ id: folders.id })
  invalidate(workspace.id)
  return { success: true, id: created.id }
}

/** Rename a folder. Workspace-scoped. */
export async function renameFolder(folderId: string, name: string): Promise<Result> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }
  const clean = cleanName(name)
  if (!clean) return { success: false, error: "Enter a folder name." }

  const result = await db
    .update(folders)
    .set({ name: clean })
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspace.id)))
    .returning({ id: folders.id })
  if (result.length === 0) return { success: false, error: "Folder not found" }
  invalidate(workspace.id)
  return { success: true }
}

/** Delete a folder; its forms fall back to Uncategorized (never deleted). */
export async function deleteFolder(folderId: string): Promise<Result> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  // Un-file the folder's forms first (defensive — the FK is also set-null).
  await db
    .update(forms)
    .set({ folderId: null })
    .where(and(eq(forms.folderId, folderId), eq(forms.workspaceId, workspace.id)))
  const result = await db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspace.id)))
    .returning({ id: folders.id })
  if (result.length === 0) return { success: false, error: "Folder not found" }
  invalidate(workspace.id)
  return { success: true }
}

/** Move a form into a folder (or out of all folders when folderId is null). */
export async function moveFormToFolder(
  formId: string,
  folderId: string | null,
): Promise<Result> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  // The target folder must belong to this workspace.
  if (folderId) {
    const [folder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspace.id)))
      .limit(1)
    if (!folder) return { success: false, error: "Folder not found" }
  }

  const result = await db
    .update(forms)
    .set({ folderId })
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .returning({ id: forms.id })
  if (result.length === 0) return { success: false, error: "Form not found" }
  invalidate(workspace.id)
  // The form's own cached reads (settings, shell) carry the folder now too.
  updateTag(`form-${formId}`)
  return { success: true }
}
