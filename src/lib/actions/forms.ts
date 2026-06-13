"use server"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields } from "@/lib/db/schema"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import type { EditorForm } from "@/lib/builder/form-model"

type SaveResult = { success: true; id: string } | { success: false; error: string }

/** Short, unguessable id for the public runtime URL (/f/[publicId]). */
function newPublicId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
}

/**
 * Persist an AI-built form to `forms` + `form_fields`, scoped to the caller's
 * workspace. Creates on first save (no formId), updates thereafter. Powers both
 * the manual Save button and debounced draft autosave in the builder.
 */
export async function saveAiForm(input: {
  formId?: string | null
  form: EditorForm
}): Promise<SaveResult> {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const title = input.form.title?.trim() || "Untitled form"
  const fields = input.form.fields ?? []

  // Verify ownership before updating an existing form.
  let formId = input.formId ?? null
  if (formId) {
    const [existing] = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
      .limit(1)
    if (!existing) return { success: false, error: "Form not found" }
  }

  try {
    await db.transaction(async (tx) => {
      if (!formId) {
        const [created] = await tx
          .insert(forms)
          .values({
            workspaceId: workspace.id,
            createdById: user.id,
            title,
            publicId: newPublicId(),
          })
          .returning({ id: forms.id })
        formId = created.id
      } else {
        await tx.update(forms).set({ title }).where(eq(forms.id, formId))
        // Drafts have no submissions, so a clean replace of fields is safe.
        await tx.delete(formFields).where(eq(formFields.formId, formId))
      }

      if (fields.length > 0) {
        await tx.insert(formFields).values(
          fields.map((f, i) => ({
            id: f.id, // stable id so logic refs + reopens survive saves
            formId: formId as string,
            type: f.type,
            label: f.label ?? "",
            description: f.description ?? null,
            placeholder: f.placeholder ?? null,
            required: f.required ?? false,
            position: i,
            options: f.options && f.options.length > 0 ? f.options : null,
            logic: f.logic ?? null,
          })),
        )
      }
    })
  } catch (err) {
    console.error("[saveAiForm] failed", err)
    return { success: false, error: "Could not save the form" }
  }

  return { success: true, id: formId as string }
}

type PublishResult =
  | { success: true; publicId: string }
  | { success: false; error: string }

/** Make a form live at /f/[publicId]. Workspace-scoped. */
export async function publishForm(formId: string): Promise<PublishResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .select({ id: forms.id, publicId: forms.publicId })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!row) return { success: false, error: "Form not found" }

  await db
    .update(forms)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(forms.id, formId))

  return { success: true, publicId: row.publicId }
}

/** Take a form offline (back to draft). Workspace-scoped. */
export async function unpublishForm(
  formId: string,
): Promise<{ success: boolean; error?: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const result = await db
    .update(forms)
    .set({ status: "draft" })
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .returning({ id: forms.id })

  if (result.length === 0) return { success: false, error: "Form not found" }
  return { success: true }
}
