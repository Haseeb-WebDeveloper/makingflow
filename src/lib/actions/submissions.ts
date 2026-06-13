"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields, submissions, answers, type AnswerValue } from "@/lib/db/schema"

/** Field types that don't collect an answer (content/layout only). */
const NON_ANSWER_TYPES = new Set(["heading", "paragraph", "image", "embed", "page_break"])

type SubmitResult = { success: true } | { success: false; error: string }

function isEmpty(v: AnswerValue | undefined): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0)
}

/**
 * Public form submission — NO auth (respondents are anonymous). Everything is
 * re-validated server-side from the form's own fields; the client is never
 * trusted for the workspace, the field set, or which form is open.
 */
export async function submitForm(input: {
  publicId: string
  answers: { fieldId: string; value: AnswerValue }[]
}): Promise<SubmitResult> {
  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.publicId, input.publicId), isNull(forms.deletedAt)))
    .limit(1)

  if (!form || form.status !== "published") {
    return { success: false, error: "This form isn't accepting responses." }
  }
  const now = new Date()
  if (form.opensAt && form.opensAt > now) return { success: false, error: "This form isn't open yet." }
  if (form.closesAt && form.closesAt < now) return { success: false, error: "This form is closed." }

  const fields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, form.id), isNull(formFields.deletedAt)))
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  // Only accept answers for real, answerable fields of THIS form.
  const accepted = input.answers.filter((a) => {
    const f = fieldById.get(a.fieldId)
    return f && !NON_ANSWER_TYPES.has(f.type) && !isEmpty(a.value)
  })
  const providedIds = new Set(accepted.map((a) => a.fieldId))

  // Enforce required.
  for (const f of fields) {
    if (f.required && !NON_ANSWER_TYPES.has(f.type) && !providedIds.has(f.id)) {
      return { success: false, error: `Please answer: ${f.label || "a required question"}` }
    }
  }

  if (form.submissionLimit != null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(eq(submissions.formId, form.id), eq(submissions.status, "completed")))
    if (count >= form.submissionLimit) return { success: false, error: "This form is closed." }
  }

  try {
    await db.transaction(async (tx) => {
      const [sub] = await tx
        .insert(submissions)
        .values({
          formId: form.id,
          workspaceId: form.workspaceId,
          status: "completed",
          mode: "classic",
          completedAt: new Date(),
        })
        .returning({ id: submissions.id })

      if (accepted.length > 0) {
        await tx.insert(answers).values(
          accepted.map((a) => {
            const f = fieldById.get(a.fieldId)!
            return {
              submissionId: sub.id,
              fieldId: f.id,
              question: f.label || "",
              type: f.type,
              value: a.value,
            }
          }),
        )
      }
    })
  } catch (err) {
    console.error("[submitForm] failed", err)
    return { success: false, error: "Couldn't submit your response. Please try again." }
  }

  return { success: true }
}
