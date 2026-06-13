import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields, submissions, answers, type AnswerValue } from "@/lib/db/schema"
import { getServerSubmissionMeta } from "@/lib/analytics/request-meta"
import { NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic"

export const maxDuration = 15

async function publishedForm(publicId: string) {
  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.publicId, publicId), isNull(forms.deletedAt)))
    .limit(1)
  if (!form || form.status !== "published") return null
  return form
}

/**
 * Save (or update) a partial draft for a public form — "save & resume" + so a
 * respondent who never finishes still leaves data we can analyze. Anonymous;
 * the unguessable submission id is the resume token, validated to be a `partial`
 * belonging to this form before we touch it.
 */
export async function POST(request: Request) {
  try {
    const { publicId, submissionId, answers: incoming } = await request.json()
    if (!publicId || !Array.isArray(incoming)) return Response.json({})

    const form = await publishedForm(publicId)
    if (!form) return Response.json({})

    const fields = await db
      .select({ id: formFields.id, type: formFields.type, label: formFields.label })
      .from(formFields)
      .where(and(eq(formFields.formId, form.id), isNull(formFields.deletedAt)))
    const byId = new Map(fields.map((f) => [f.id, f]))

    const accepted = (incoming as { fieldId: string; value: AnswerValue }[]).filter((a) => {
      const f = byId.get(a.fieldId)
      return f && !NON_ANSWER_TYPES.has(f.type) && !isEmpty(a.value)
    })
    if (accepted.length === 0) return Response.json({}) // nothing to save yet

    const serverMeta = await getServerSubmissionMeta()
    const metaValue = Object.keys(serverMeta).length > 0 ? serverMeta : null

    let sid: string | null = null
    if (submissionId) {
      const [existing] = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.id, submissionId),
            eq(submissions.formId, form.id),
            eq(submissions.status, "partial"),
          ),
        )
        .limit(1)
      if (existing) sid = existing.id
    }

    await db.transaction(async (tx) => {
      if (!sid) {
        const [sub] = await tx
          .insert(submissions)
          .values({
            formId: form.id,
            workspaceId: form.workspaceId,
            status: "partial",
            mode: form.renderMode,
            meta: metaValue,
          })
          .returning({ id: submissions.id })
        sid = sub.id
      } else {
        await tx
          .update(submissions)
          .set({ meta: metaValue, updatedAt: new Date() })
          .where(eq(submissions.id, sid))
        await tx.delete(answers).where(eq(answers.submissionId, sid))
      }
      await tx.insert(answers).values(
        accepted.map((a) => {
          const f = byId.get(a.fieldId)!
          return {
            submissionId: sid as string,
            fieldId: f.id,
            question: f.label || "",
            type: f.type,
            value: a.value,
          }
        }),
      )
    })

    return Response.json({ submissionId: sid })
  } catch (err) {
    console.error("[partial] save failed", err)
    return Response.json({})
  }
}

/** Resume: return the saved draft answers for a partial submission. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const publicId = searchParams.get("publicId")
    const submissionId = searchParams.get("submissionId")
    if (!publicId || !submissionId) return Response.json({ values: {} })

    const form = await publishedForm(publicId)
    if (!form) return Response.json({ values: {} })

    const [sub] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.id, submissionId),
          eq(submissions.formId, form.id),
          eq(submissions.status, "partial"),
        ),
      )
      .limit(1)
    if (!sub) return Response.json({ values: {} })

    const rows = await db
      .select({ fieldId: answers.fieldId, value: answers.value })
      .from(answers)
      .where(eq(answers.submissionId, sub.id))
    const values: Record<string, AnswerValue> = {}
    for (const r of rows) if (r.fieldId) values[r.fieldId] = r.value
    return Response.json({ values })
  } catch (err) {
    console.error("[partial] resume failed", err)
    return Response.json({ values: {} })
  }
}
