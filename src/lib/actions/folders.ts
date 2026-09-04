"use server"

/**
 * Folder Server Actions — the browser's entry point.
 *
 * These are thin on purpose. Each one resolves the caller from the session
 * cookie and hands off to src/lib/core/folders.ts, which holds the actual
 * logic and is shared with the MCP server. Exported names and signatures are
 * unchanged, so every component that imports them is untouched.
 *
 * Nothing tenant-aware belongs in this file. If you are about to write a query
 * here, it belongs in core — otherwise the MCP surface silently misses it.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as foldersCore from "@/lib/core/folders"

type Result = { success: true } | { success: false; error: string }

/** Create a folder in the active workspace. */
export async function createFolder(
  name: string,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return foldersCore.createFolder(session.ctx, name)
}

/** Rename a folder. Workspace-scoped. */
export async function renameFolder(folderId: string, name: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return foldersCore.renameFolder(session.ctx, folderId, name)
}

/** Delete a folder; its forms fall back to Uncategorized (never deleted). */
export async function deleteFolder(folderId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return foldersCore.deleteFolder(session.ctx, folderId)
}

/** Move a form into a folder (or out of all folders when folderId is null). */
export async function moveFormToFolder(formId: string, folderId: string | null): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return foldersCore.moveFormToFolder(session.ctx, formId, folderId)
}
