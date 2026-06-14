"use server"

import { after } from "next/server"
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
import { revalidatePath } from "next/cache"
import { getVisitorKey, getRespondentKey, logFormEvent } from "@/lib/analytics/track"
import { getServerSubmissionMeta } from "@/lib/analytics/request-meta"
import { syncSubmissionToSheets, deleteSubmissionFromSheet } from "@/lib/integrations/sync"
import { deliverWebhooks } from "@/lib/integrations/webhook"
import { sendSubmissionEmails } from "@/lib/integrations/email"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { NON_ANSWER_TYPES, isEmpty } from "@/lib/builder/logic"

// Server-side submit guards (the client validates too, but a crafted POST skips
// it — never store unbounded or malformed data).
const MAX_ANSWERS = 1000
const MAX_VALUE_LEN = 50_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/\S+\.\S+/i

type FieldRow = typeof formFields.$inferSelect

function valueLength(v: AnswerValue): number {
  if (typeof v === "string") return v.length
  if (Array.isArray(v)) return v.reduce((n, x) => n + String(x).length, 0)
  return String(v ?? "").length
}

/**
 * Validate one answer against its field type. Returns an error string or null.
 *
 * `strict` (classic mode only) additionally enforces format/option membership —
 * safe there because the classic client already validates with the same rules,
 * so it never false-rejects a legit submit. Conversational answers are AI-coerced
 * (and may keep raw free text for unmatched choices), so they get size + type
 * sanity only.
 */
function validateAnswer(field: FieldRow, value: AnswerValue, strict: boolean): string | null {
  const label = field.label || "a field"
  if (valueLength(value) > MAX_VALUE_LEN) return `Your answer for "${label}" is too long.`

  // Type sanity — always enforced (a multi-select must be an array, etc.).
  if (field.type === "multi_select" || field.type === "checkboxes") {
    if (!Array.isArray(value)) return `Invalid answer for "${label}".`
  }
  if (!strict) return null

  const opts = (field.options ?? []).map((o) => o.label)
  switch (field.type) {
    case "email":
      if (typeof value !== "string" || !EMAIL_RE.test(value))
        return `Enter a valid email for "${label}".`
      break
    case "url":
      if (typeof value !== "string" || !URL_RE.test(value))
        return `Enter a valid URL for "${label}".`
      break
    case "yes_no":
      if (value !== "Yes" && value !== "No") return `Invalid answer for "${label}".`
      break
    case "multiple_choice":
    case "dropdown":
      if (typeof value !== "string" || (opts.length > 0 && !opts.includes(value)))
        return `Invalid option for "${label}".`
      break
    case "multi_select":
    case "checkboxes":
      if (Array.isArray(value) && opts.length > 0 && value.some((v) => !opts.includes(String(v))))
        return `Invalid option for "${label}".`
      break
    case "nps":
    case "rating":
    case "scale": {
      const n = Number(value)
      if (!Number.isFinite(n)) return `Invalid value for "${label}".`
      break
    }
  }
  return null
}

type SubmitResult = { success: true } | { success: false; error: string }

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
export type SubmitAnswer = {
  /** Real form field id, or null for an AI follow-up question (conversational). */
  fieldId: string | null
  value: AnswerValue
  /** Conversational multi-language: what the respondent literally said + its
   *  language, when it differs from the form's base language. */
  originalValue?: AnswerValue
  originalLanguage?: string
  /** Follow-up questions the AI asked that aren't form fields. */
  isAiFollowUp?: boolean
  /** Snapshot question text — required for follow-ups (no field to derive it). */
  question?: string
  /** Snapshot field type — follow-ups default to long_text. */
  type?: string
}

export async function submitForm(input: {
  publicId: string
  answers: SubmitAnswer[]
  /** Client-captured context: original referrer + UTM/query params. */
  meta?: { referrer?: string; urlParams?: Record<string, string> }
  /** A partial draft to promote to completed (save & resume), if any. */
  submissionId?: string | null
  /** Language the respondent answered in (conversational mode). */
  language?: string | null
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

  if (!Array.isArray(input.answers) || input.answers.length > MAX_ANSWERS) {
    return { success: false, error: "Couldn't submit your response. Please try again." }
  }

  const fields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, form.id), isNull(formFields.deletedAt)))
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  // Only accept answers for real, answerable fields of THIS form.
  const accepted = input.answers.filter(
    (a): a is SubmitAnswer & { fieldId: string } => {
      if (!a.fieldId) return false
      const f = fieldById.get(a.fieldId)
      return !!f && !NON_ANSWER_TYPES.has(f.type) && !isEmpty(a.value)
    },
  )
  const providedIds = new Set(accepted.map((a) => a.fieldId))

  // AI follow-up answers (conversational): no field id, kept verbatim. Skipped
  // when empty (answers.value is NOT NULL) or missing a question snapshot.
  const followUps = input.answers.filter(
    (a) => !a.fieldId && a.isAiFollowUp && !isEmpty(a.value) && !!a.question?.trim(),
  )

  // Re-validate every accepted answer against its field (format, option
  // membership, size) — the client checks these, but a crafted POST doesn't.
  // Strict format/option checks apply to classic mode only (see validateAnswer).
  const strict = form.renderMode === "classic"
  for (const a of accepted) {
    const err = validateAnswer(fieldById.get(a.fieldId)!, a.value, strict)
    if (err) return { success: false, error: err }
  }
  for (const a of followUps) {
    if (valueLength(a.value) > MAX_VALUE_LEN) {
      return { success: false, error: "One of your answers is too long." }
    }
  }

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

  // One response per person: block a respondent (coarse device identity) who
  // already has a completed response. Best-effort — stored on the row so it's
  // enforced and visible going forward.
  let respondentKey: string | null = null
  if (form.oneResponsePerPerson) {
    respondentKey = await getRespondentKey()
    if (respondentKey) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(submissions)
        .where(
          and(
            eq(submissions.formId, form.id),
            eq(submissions.status, "completed"),
            eq(submissions.respondentKey, respondentKey),
          ),
        )
      if (count > 0) {
        return { success: false, error: "You've already responded to this form." }
      }
    }
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
      // Promote the respondent's partial draft (save & resume) to completed if
      // they have one; otherwise create a fresh completed submission.
      if (input.submissionId) {
        const promoted = await tx
          .update(submissions)
          .set({
            status: "completed",
            completedAt: new Date(),
            meta: metaValue,
            mode: form.renderMode,
            language: input.language ?? null,
            respondentKey,
          })
          .where(
            and(
              eq(submissions.id, input.submissionId),
              eq(submissions.formId, form.id),
              eq(submissions.status, "partial"),
            ),
          )
          .returning({ id: submissions.id })
        if (promoted.length > 0) {
          submissionId = promoted[0].id
          // Replace the draft answers with the final validated set.
          await tx.delete(answers).where(eq(answers.submissionId, submissionId))
        }
      }
      if (!submissionId) {
        const [sub] = await tx
          .insert(submissions)
          .values({
            formId: form.id,
            workspaceId: form.workspaceId,
            status: "completed",
            mode: form.renderMode,
            language: input.language ?? null,
            completedAt: new Date(),
            meta: metaValue,
            respondentKey,
          })
          .returning({ id: submissions.id })
        submissionId = sub.id
      }
      const sid = submissionId as string

      const answerRows = accepted.map((a) => {
        const f = fieldById.get(a.fieldId)!
        return {
          submissionId: sid,
          fieldId: f.id,
          isAiFollowUp: false,
          question: f.label || "",
          type: f.type,
          value: a.value,
          originalValue: a.originalValue ?? null,
          originalLanguage: a.originalLanguage ?? null,
        }
      })
      // AI follow-ups: fieldId NULL (safe under the unique (submissionId,fieldId)
      // index because Postgres treats NULLs as distinct), type defaults long_text.
      for (const a of followUps) {
        answerRows.push({
          submissionId: sid,
          fieldId: null as unknown as string,
          isAiFollowUp: true,
          question: a.question!.trim(),
          type: (a.type ?? "long_text") as (typeof answers.$inferInsert)["type"],
          value: a.value,
          originalValue: a.originalValue ?? null,
          originalLanguage: a.originalLanguage ?? null,
        })
      }
      if (answerRows.length > 0) await tx.insert(answers).values(answerRows)

      // Track respondent uploads (file_upload/signature) for storage/quota.
      const uploadRows = accepted.flatMap((a) => {
        const f = fieldById.get(a.fieldId)!
        if (f.type !== "file_upload" && f.type !== "signature") return []
        return filesFromValue(a.value).map((file) => ({
          workspaceId: form.workspaceId,
          formId: form.id,
          submissionId: sid,
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

  // Everything below is best-effort, post-commit work (funnel event + integration
  // delivery — Sheets/webhooks/email, each with its own network I/O and a slow
  // webhook can take seconds). Defer it with after() so the respondent's response
  // returns the instant the submission is committed; a down integration can never
  // delay or fail a stored submission. Read request-scoped context (visitorKey
  // from headers) NOW, before deferring.
  const visitorKey = await getVisitorKey()
  const submittedAt = new Date()
  const webhookAnswers = accepted.map((a) => ({
    fieldId: a.fieldId,
    question: fieldById.get(a.fieldId)?.label || "",
    value: a.value,
  }))
  const committedId = submissionId

  after(async () => {
    await logFormEvent({
      formId: form.id,
      type: "complete",
      submissionId: committedId ?? undefined,
      visitorKey,
    })
    await Promise.allSettled([
      // Google Sheets: workspace connection auto-syncs every form (sheet created lazily).
      syncSubmissionToSheets(
        { id: form.id, workspaceId: form.workspaceId, title: form.title },
        accepted,
        submittedAt,
        committedId ?? "",
      ),
      deliverWebhooks(
        { id: form.id, title: form.title, publicId: form.publicId },
        webhookAnswers,
        { id: committedId ?? "", submittedAt },
      ),
      sendSubmissionEmails({ id: form.id, title: form.title }, webhookAnswers),
    ])
  })

  return { success: true }
}

/**
 * Owner-side: permanently delete a submission (and its answers, via cascade).
 * Workspace-scoped — only a member of the submission's workspace can delete it.
 * Mirrors the deletion to Google Sheets (best-effort, after commit) so the sheet
 * stays in sync.
 */
export async function deleteSubmission(submissionId: string): Promise<SubmitResult> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "Not authorized" }

  const [sub] = await db
    .select({ id: submissions.id, formId: submissions.formId, workspaceId: submissions.workspaceId })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1)
  // Never reveal a submission from another tenant — same response as "not found".
  if (!sub || sub.workspaceId !== workspace.id) {
    return { success: false, error: "Submission not found" }
  }

  try {
    await db.delete(submissions).where(eq(submissions.id, submissionId))
  } catch (err) {
    console.error("[deleteSubmission] failed", err)
    return { success: false, error: "Couldn't delete the response. Please try again." }
  }

  // Refresh the owner views (insights + submissions table) on next render.
  revalidatePath(`/forms/${sub.formId}`)
  revalidatePath(`/forms/${sub.formId}/submissions`)

  // Remove the matching sheet row off the request path — a Sheets outage must
  // not fail a delete that already committed in our DB.
  after(() =>
    deleteSubmissionFromSheet({ id: sub.formId, workspaceId: sub.workspaceId }, submissionId),
  )

  return { success: true }
}
