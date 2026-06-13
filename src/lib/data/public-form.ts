import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields, submissions, type FieldLogic } from "@/lib/db/schema"

export type PublicOption = { id: string; label: string }

export type PublicField = {
  id: string
  type: string
  label: string
  description?: string
  placeholder?: string
  required: boolean
  options?: PublicOption[]
  logic?: FieldLogic
}

export type PublicForm = {
  publicId: string
  title: string
  submitLabel: string
  thankYou: string
  fields: PublicField[]
}

export type PublicFormResult =
  | { state: "ok"; form: PublicForm }
  | { state: "missing" }
  | { state: "unavailable" }

/**
 * Load a published form for the public runtime (/f/[publicId]). No auth, no
 * workspace scoping — but only PUBLISHED, in-window, under-limit forms resolve.
 */
export async function getPublicForm(publicId: string): Promise<PublicFormResult> {
  const [row] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.publicId, publicId), isNull(forms.deletedAt)))
    .limit(1)

  if (!row) return { state: "missing" }

  const now = new Date()
  if (row.status !== "published") return { state: "unavailable" }
  if (row.opensAt && row.opensAt > now) return { state: "unavailable" }
  if (row.closesAt && row.closesAt < now) return { state: "unavailable" }
  if (row.submissionLimit != null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(eq(submissions.formId, row.id), eq(submissions.status, "completed")))
    if (count >= row.submissionLimit) return { state: "unavailable" }
  }

  const fields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, row.id), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)

  return {
    state: "ok",
    form: {
      publicId: row.publicId,
      title: row.title,
      submitLabel: row.settings?.submitButtonLabel || "Submit",
      thankYou: row.settings?.thankYouMessage || "Thanks! Your response has been recorded.",
      fields: fields.map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        description: f.description ?? undefined,
        placeholder: f.placeholder ?? undefined,
        required: f.required,
        options: f.options ?? undefined,
        logic: f.logic ?? undefined,
      })),
    },
  }
}
