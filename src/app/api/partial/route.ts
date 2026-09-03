import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields, submissions, answers, type AnswerValue } from "@/lib/db/schema"
import { getServerSubmissionMeta } from "@/lib/analytics/request-meta"
import { NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic"
import { MAX_ANSWERS, MAX_VALUE_LEN, valueLength } from "@/lib/submissions/limits"
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rate-limit"

export const maxDuration = 15

/**
 * The form a draft may be written against: published AND inside its open
 * window. The window check matters because a closed form must stop accepting
 * writes of any kind, not just final submissions.
 *
 * `submissionLimit` is deliberately NOT checked here — a partial is not a
 * submission, and counting completed rows on every keystroke would put a
 * COUNT(*) on the hottest write path in the app.
 */
async function writableForm(publicId: string) {
  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.publicId, publicId), isNull(forms.deletedAt)))
    .limit(1)
  if (!form || form.status !== "published") return null
  const now = new Date()
  if (form.opensAt && form.opensAt > now) return null
  if (form.closesAt && form.closesAt < now) return null
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
    const limit = await rateLimit("partial", LIMITS.partial)
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds)

    const { publicId, submissionId, answers: incoming } = await request.json()
    if (!publicId || !Array.isArray(incoming)) return Response.json({})
    // Same ceilings the final submit enforces — this endpoint is anonymous and
    // writes straight to `answers`, so it can't be the lax one.
    if (incoming.length > MAX_ANSWERS) return Response.json({})

    const form = await writableForm(publicId)
    if (!form) return Response.json({})

    const fields = await db
      .select({ id: formFields.id, type: formFields.type, label: formFields.label })
      .from(formFields)
      .where(and(eq(formFields.formId, form.id), isNull(formFields.deletedAt)))
    const byId = new Map(fields.map((f) => [f.id, f]))

    // Collapse to one entry per field (last wins). Two entries for the same
    // field would violate `answers_submission_field_idx` and abort the whole
    // transaction, losing the draft.
    const byField = new Map<string, AnswerValue>()
    for (const a of incoming as { fieldId: string; value: AnswerValue }[]) {
      const f = byId.get(a.fieldId)
      if (!f || NON_ANSWER_TYPES.has(f.type) || isEmpty(a.value)) continue
      if (valueLength(a.value) > MAX_VALUE_LEN) continue
      byField.set(a.fieldId, a.value)
    }
    if (byField.size === 0) return Response.json({}) // nothing to save yet

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
      // No match means the draft is gone as a draft: either it was already
      // promoted to `completed` by submitForm, or the id is bogus. Falling
      // through to the insert below is precisely how a finished submission
      // acquired a duplicate `partial` twin holding the same answers — which
      // then scored as an abandon at the last question in the drop-off chart.
      // The respondent told us which row to update; if it isn't updatable,
      // there is nothing to do.
      if (!existing) return Response.json({})
      sid = existing.id
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
        [...byField].map(([fieldId, value]) => {
          const f = byId.get(fieldId)!
          return {
            submissionId: sid as string,
            fieldId: f.id,
            question: f.label || "",
            type: f.type,
            value,
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
    const limit = await rateLimit("partial-resume", LIMITS.partialResume)
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds)

    const { searchParams } = new URL(request.url)
    const publicId = searchParams.get("publicId")
    const submissionId = searchParams.get("submissionId")
    if (!publicId || !submissionId) return Response.json({ values: {} })

    const form = await writableForm(publicId)
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
