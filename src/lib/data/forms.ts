import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import type { AiFieldType } from "@/lib/ai/form-schema"
import type { EditorForm } from "@/lib/builder/form-model"

/** Forms in the caller's workspace, newest first — for the /forms list. */
export async function getWorkspaceForms() {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return []

  return db
    .select({
      id: forms.id,
      title: forms.title,
      status: forms.status,
      updatedAt: forms.updatedAt,
    })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .orderBy(desc(forms.updatedAt))
}

export type EditableForm = {
  id: string
  form: EditorForm
  status: string
  publicId: string
}

/** Load one form (workspace-scoped) and map it back to the AI form spec. */
export async function getFormForEdit(id: string): Promise<EditableForm | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  const [row] = await db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.id, id),
        eq(forms.workspaceId, workspace.id),
        isNull(forms.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null

  const fields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, id), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)

  const form: EditorForm = {
    title: row.title,
    fields: fields.map((f) => ({
      id: f.id,
      type: f.type as AiFieldType,
      label: f.label,
      description: f.description ?? undefined,
      placeholder: f.placeholder ?? undefined,
      required: f.required,
      options: f.options ?? undefined,
      logic: f.logic ?? undefined,
    })),
  }

  return { id: row.id, form, status: row.status, publicId: row.publicId }
}
