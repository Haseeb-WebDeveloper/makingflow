import { cacheLife, cacheTag } from "next/cache"
import { asc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { folders } from "@/lib/db/schema"

export type WorkspaceFolder = { id: string; name: string }

/**
 * Folders in the workspace, A–Z — for the sidebar groups + /forms sections.
 * Shares the `workspace-forms-${id}` cache tag with the forms list so a folder
 * OR form mutation refreshes both together.
 */
export async function getWorkspaceFolders(workspaceId: string): Promise<WorkspaceFolder[]> {
  "use cache"
  cacheLife("minutes")
  cacheTag(`workspace-forms-${workspaceId}`)
  return db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(eq(folders.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${folders.name})`))
}
