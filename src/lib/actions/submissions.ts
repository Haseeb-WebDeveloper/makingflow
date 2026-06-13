"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formFields,
  submissions,
  answers,
  uploads,
  type AnswerValue,
  type SubmissionMeta,
} from "@/lib/db/schema"
import { getVisitorKey, logFormEvent } from "@/lib/analytics/track"
import { getServerSubmissionMeta } from "@/lib/analytics/request-meta"
import { syncSubmissionToSheets } from "@/lib/integrations/sync"

/** Field types that don't collect an answer (content/layout only). */
const NON_ANSWER_TYPES = new Set(["heading", "paragraph", "image", "embed", "page_break"])

type SubmitResult = { success: true } | { success: false; error: string }

function isEmpty(v: AnswerValue | undefined): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0)
}

type StoredFile = { storageKey: string; url: string; name: string; mime: string; bytes: number }

/** Extract uploaded-file metadata from a file_upload/signature answer value. */
function filesFromValue(v: AnswerValue | undefined): StoredFile[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  const files = (v as { files?: unknown }).files
  if (!Array.isArray(files)) return []
  return files.filter(
    (f): f is StoredFile =>
      !!f &&
      typeof f === "object" &&
      typeof (f as StoredFile).storageKey === "string" &&
      (f as StoredFile).storageKey !== "" &&
      typeof (f as StoredFile).url === "string",
  )
}

/**
 * Public form submission — NO auth (respondents are anonymous). Everything is
 * re-validated server-side from the form's own fields; the client is never
 * trusted for the workspace, the field set, or which form is open.
 */
export async function submitForm(input: {
  publicId: string
  answers: { fieldId: string; value: AnswerValue }[]
  /** Client-captured context: original referrer + UTM/query params. */
  meta?: { referrer?: string; urlParams?: Record<string, string> }
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

  // Respondent context: device/country/UA from headers + referrer/UTM from the client.
  const serverMeta = await getServerSubmissionMeta()
  const meta: SubmissionMeta = { ...serverMeta }
  const referrer = input.meta?.referrer?.trim()
  if (referrer) meta.referrer = referrer.slice(0, 500)
  const urlParams = input.meta?.urlParams
  if (urlParams && Object.keys(urlParams).length > 0) meta.urlParams = urlParams
  const metaValue = Object.keys(meta).length > 0 ? meta : null

  let submissionId: string | null = null
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
          meta: metaValue,
        })
        .returning({ id: submissions.id })
      submissionId = sub.id

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

      // Track respondent uploads (file_upload/signature) for storage/quota.
      const uploadRows = accepted.flatMap((a) => {
        const f = fieldById.get(a.fieldId)!
        if (f.type !== "file_upload" && f.type !== "signature") return []
        return filesFromValue(a.value).map((file) => ({
          workspaceId: form.workspaceId,
          formId: form.id,
          submissionId: sub.id,
          storageKey: file.storageKey,
          url: file.url,
          fileName: file.name,
          mimeType: file.mime || "application/octet-stream",
          bytes: Math.round(file.bytes) || 0,
        }))
      })
      if (uploadRows.length > 0) await tx.insert(uploads).values(uploadRows)
    })
  } catch (err) {
    console.error("[submitForm] failed", err)
    return { success: false, error: "Couldn't submit your response. Please try again." }
  }

  // Funnel: record the completion (best-effort, never fails the submit).
  const visitorKey = await getVisitorKey()
  await logFormEvent({
    formId: form.id,
    type: "complete",
    submissionId: submissionId ?? undefined,
    visitorKey,
  })

  // Deliver to connected integrations (Google Sheets). Best-effort — a sync
  // failure must never turn a stored submission into an error for the
  // respondent, so it runs after commit and swallows its own errors. The
  // workspace's Google connection auto-syncs every form (sheet created lazily).
  await syncSubmissionToSheets(
    { id: form.id, workspaceId: form.workspaceId, title: form.title },
    accepted,
    new Date(),
  )

  return { success: true }
}
