"use server"

/**
 * Tally-import Server Actions. Logic lives in src/lib/core/import-tally.ts.
 *
 * The move mattered more here than anywhere else: this module used to import
 * `saveAiForm` and `updateFormSettings` from `@/lib/actions/forms` — the
 * `"use server"` wrappers, which resolve the caller from the session cookie. It
 * was the only cross-action import in the codebase, and under a bearer token it
 * would have returned "Not signed in" and failed every import, at the point
 * where the form had already been fetched from Tally. Core now calls core.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as importCore from "@/lib/core/import-tally"

// Re-exported: components import these result types from this module today.
export type {
  ImportApiResult,
  ImportFormResult,
  ImportSubmissionsResult,
  ListTallyFormsResult,
  FileIntoFoldersResult,
} from "@/lib/core/import-tally"

/** Rebuild a public Tally form here as a draft. */
export async function importTallyForm(url: string): Promise<importCore.ImportFormResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return importCore.importTallyForm(session.ctx, url)
}

/** Load a Tally CSV export into a form imported from that same Tally form. */
export async function importTallySubmissions(
  formId: string,
  csv: string,
): Promise<importCore.ImportSubmissionsResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return importCore.importTallySubmissions(session.ctx, formId, csv)
}

/** List the forms an API key can reach, so the user can pick. */
export async function listTallyApiForms(
  apiKey: string,
): Promise<importCore.ListTallyFormsResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return importCore.listTallyApiForms(session.ctx, apiKey)
}

/** Import one form (and optionally its responses) using an API key. */
export async function importTallyFormFromApiKey(
  apiKey: string,
  tallyFormId: string,
  withResponses: boolean,
  options?: { folderName?: string; startPage?: number },
): Promise<importCore.ImportApiResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return importCore.importTallyFormFromApiKey(
    session.ctx,
    apiKey,
    tallyFormId,
    withResponses,
    options,
  )
}

/** File already-imported forms into folders matching their Tally workspace. */
export async function fileImportedFormsIntoFolders(
  apiKey: string,
): Promise<importCore.FileIntoFoldersResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return importCore.fileImportedFormsIntoFolders(session.ctx, apiKey)
}
