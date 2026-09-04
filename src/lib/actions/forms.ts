"use server"

/**
 * Form Server Actions — the browser's entry point.
 *
 * Thin by design: resolve the caller from the session cookie, hand off to
 * src/lib/core/forms.ts. The core holds the logic and is shared with the MCP
 * server, so anything written here instead of there is invisible to every AI
 * client. Exported names, signatures and return shapes are unchanged, so no
 * component moved.
 *
 * `FormSettingsPatch` is re-exported from core because components import the
 * type from this module today.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as formsCore from "@/lib/core/forms"
import type { EditorForm } from "@/lib/builder/form-model"

export type { FormSettingsPatch } from "@/lib/core/forms"

type SaveResult = { success: true; id: string } | { success: false; error: string }
type PublishResult = { success: true; publicId: string } | { success: false; error: string }

/** Create an empty draft form and return its id. */
export async function createDraftForm(folderId?: string | null): Promise<{ id: string }> {
  const session = await sessionContext()
  // Throws rather than returning a Result — this one's callers navigate on the
  // returned id and have nothing to render an error into. Preserved from the
  // original signature.
  if (!session.ok) throw new Error(session.error)
  return formsCore.createDraftForm(session.ctx, folderId)
}

/** Persist an AI-built form to `forms` + `form_fields`. */
export async function saveAiForm(input: {
  formId?: string | null
  form: EditorForm
}): Promise<SaveResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.saveAiForm(session.ctx, input)
}

/** Make a form live at /f/[publicId]. */
export async function publishForm(formId: string): Promise<PublishResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.publishForm(session.ctx, formId)
}

/** Take a form offline (back to draft). */
export async function unpublishForm(
  formId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.unpublishForm(session.ctx, formId)
}

/** Rename a form; empty titles fall back to "Untitled form". */
export async function renameForm(
  formId: string,
  title: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.renameForm(session.ctx, formId, title)
}

/** Duplicate a form (definition + fields) as a fresh draft. */
export async function duplicateForm(
  formId: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.duplicateForm(session.ctx, formId)
}

/** Permanently delete a form and everything it owns. */
export async function deleteForm(formId: string): Promise<{ success: boolean; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.deleteForm(session.ctx, formId)
}

/** Update a form's response-collection settings. */
export async function updateFormSettings(
  formId: string,
  patch: formsCore.FormSettingsPatch,
): Promise<{ success: boolean; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return formsCore.updateFormSettings(session.ctx, formId, patch)
}
