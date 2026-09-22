"use server"

/**
 * Asking for an export.
 *
 * `requestMediaArchive` is the one that exists so far, and it is deliberately
 * SYNCHRONOUS even though the plan files media exports under the export queue.
 * Cloudinary builds the archive itself and returns its URL in one call, so the
 * only work on our side is scanning the scope for assets — which is bounded by
 * the same row ceiling the CSV download uses. A queue would add a table, a
 * worker and an email before a recruiter could download a single CV.
 *
 * What the ceiling protects is real: the scan reads every answer in scope, and
 * above SYNC_ROW_CEILING that cannot be relied on to finish inside the route's
 * sixty seconds. Over it, the answer is an honest refusal rather than a
 * half-built archive.
 */

import { getDefaultWorkspace } from "@/lib/auth/session"
import { countExportRows, openExport } from "@/lib/submissions/export-query"
import {
  buildMediaArchives,
  MediaArchiveError,
  type MediaArchive,
} from "@/lib/submissions/export-media"
import { exportSpecSchema, SYNC_ROW_CEILING, type ExportSpec } from "@/lib/submissions/export-spec"

export type MediaArchiveResult =
  | {
      success: true
      archives: MediaArchive[]
      fileCount: number
      /**
       * Files that were in the responses but not in the archives, because
       * storage no longer had them. Told rather than hidden: Cloudinary is
       * asked to tolerate a missing file so one purged upload cannot fail the
       * whole download, and that leniency must not read as completeness.
       */
      missing: number
    }
  | { success: false; error: string }

export async function requestMediaArchive(
  formId: string,
  input: ExportSpec,
): Promise<MediaArchiveResult> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "Not signed in" }

  const parsed = exportSpecSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "That export request is not valid" }
  const spec = parsed.data

  // Tenancy first, and through the same query the download route uses: a form
  // id from another workspace must be indistinguishable from one that does not
  // exist.
  const source = await openExport(formId, workspace.id, spec)
  if (!source) return { success: false, error: "Form not found" }

  const rowCount = await countExportRows(formId, spec)
  if (rowCount > SYNC_ROW_CEILING) {
    return {
      success: false,
      error: `That is too many responses to archive at once (${rowCount.toLocaleString()}). Narrow the range with a filter or a date range and try again.`,
    }
  }

  try {
    const result = await buildMediaArchives(source, new Date())
    if (result.archives.length === 0) {
      return { success: false, error: "These responses have no uploaded files." }
    }
    const delivered = result.archives.reduce((n, a) => n + a.fileCount, 0)
    const requested = result.archives.reduce((n, a) => n + a.requested, 0)
    return {
      success: true,
      archives: result.archives,
      fileCount: delivered,
      missing: Math.max(0, requested - delivered),
    }
  } catch (err) {
    // MediaArchiveError messages are written for a form owner to read; anything
    // else is ours and stays out of the UI.
    if (err instanceof MediaArchiveError) return { success: false, error: err.message }
    console.error("[export] media archive failed", err)
    return { success: false, error: "The archive could not be built. Please try again." }
  }
}
