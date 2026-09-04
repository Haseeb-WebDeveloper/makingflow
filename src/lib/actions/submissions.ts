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
import { getVisitorKey, getRespondentKey, logFormEvent } from "@/lib/analytics/track"
import { getServerSubmissionMeta } from "@/lib/analytics/request-meta"
import { syncSubmissionToSheets } from "@/lib/integrations/sync"
import { deliverWebhooks } from "@/lib/integrations/webhook"
import { sendSubmissionEmails } from "@/lib/integrations/email"
import { deliverDiscord } from "@/lib/integrations/discord"
import { syncSubmissionToNotion } from "@/lib/integrations/notion-sync"
import { isCloudinaryUrl } from "@/lib/cloudinary/url"
import { processSubmission, intelligenceEnabled } from "@/lib/ai/submission-intelligence"
import { sessionContext } from "@/lib/auth/context-web"
import * as submissionsCore from "@/lib/core/submissions"
import { NON_ANSWER_TYPES, isEmpty, isFieldVisible } from "@/lib/builder/logic"
import { MAX_ANSWERS, MAX_VALUE_LEN, valueLength } from "@/lib/submissions/limits"
import { LIMITS, rateLimit } from "@/lib/rate-limit"
import { isUniqueViolation } from "@/lib/db/errors"

// Server-side submit guards (the client validates too, but a crafted POST skips
// it — never store unbounded or malformed data). Shared with /api/partial.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/\S+\.\S+/i

type FieldRow = typeof formFields.$inferSelect

/**
 * Validate one answer against its field type. Returns an error string or null.
 *
 * `strict` (classic mode only) additionally enforces format/option membership.
 * Conversational answers are AI-coerced (and may keep raw free text for
 * unmatched choices), so they get size + type sanity only.
 *
 * NOTE on option membership: a field with `config.allowOther` stores the
 * respondent's typed text AS the answer — that is the whole design of the Other
 * box (see OtherChoice in field-control.tsx), and the client validator never
 * checks membership. Enforcing it here regardless made every classic form with
 * an Other option unsubmittable the moment someone used it: the answer is by
 * definition not one of the listed labels. So membership is only enforced when
 * Other is off.
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
  const allowOther = field.config?.allowOther === true
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
      if (typeof value !== "string") return `Invalid option for "${label}".`
      if (!allowOther && opts.length > 0 && !opts.includes(value))
        return `Invalid option for "${label}".`
      break
    case "multi_select":
    case "checkboxes":
      if (Array.isArray(value) && opts.length > 0) {
        const extras = value.filter((v) => !opts.includes(String(v)))
        // With Other enabled exactly ONE value may sit outside the option list —
        // the text typed into the Other box. Two or more means the payload
        // didn't come from the runtime, so it's still rejected.
        if (extras.length > (allowOther ? 1 : 0)) return `Invalid option for "${label}".`
      }
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

/** Ceiling for a single respondent upload. Far above any real file, low enough
 *  that one forged `bytes` can't blow out the workspace storage total. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024 // 1 GB

/**
 * Extract uploaded-file metadata from a file_upload/signature answer value.
 *
 * Uploads go straight from the respondent's browser to Cloudinary, so every
 * field here is attacker-controlled: whatever is posted is what lands in
 * `uploads`, where `url` is later rendered and `bytes` is summed into the
 * workspace storage quota. Previously only `storageKey`/`url` were checked for
 * being non-empty strings, so a crafted submit could point a row at any URL and
 * claim any size. Each entry is now validated and bounded, and one that fails
 * is dropped rather than stored.
 */
function filesFromValue(v: AnswerValue | undefined): StoredFile[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  const files = (v as { files?: unknown }).files
  if (!Array.isArray(files)) return []

  const out: StoredFile[] = []
  for (const f of files) {
    if (!f || typeof f !== "object") continue
    const r = f as Record<string, unknown>
    const storageKey = typeof r.storageKey === "string" ? r.storageKey : ""
    const url = typeof r.url === "string" ? r.url : ""
    // Pins the host AND our cloud name — another account's URL doesn't qualify.
    if (!storageKey || !isCloudinaryUrl(url)) continue
    const raw = r.bytes
    const bytes = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : -1
    if (bytes < 0 || bytes > MAX_FILE_BYTES) continue
    out.push({
      storageKey: storageKey.slice(0, 500),
      url,
      name: typeof r.name === "string" && r.name ? r.name.slice(0, 255) : "file",
      mime: typeof r.mime === "string" ? r.mime.slice(0, 100) : "",
      bytes,
    })
  }
  return out
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
  // Sized per IP, and an IP is a whole office or conference — not a person
  // (see LIMITS). Blocking a genuine respondent loses a submission the owner
  // never finds out about, so this is the most generous budget of the set.
  const limit = await rateLimit("submit", LIMITS.submit)
  if (!limit.ok) {
    return { success: false, error: "Too many attempts. Please wait a moment and try again." }
  }

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

  // Enforce required — but ONLY for fields the respondent could actually see.
  //
  // A field hidden by its conditional logic is never sent: both runtimes build
  // the payload with `isFieldVisible` (form-runtime.tsx, conversational-
  // runtime.tsx). Enforcing `required` across every field regardless of logic
  // therefore rejected the submission for a question that was never on screen —
  // e.g. a required "Pet's name" shown only when "Do you have a pet?" is Yes
  // made the form permanently unsubmittable for anyone answering No, with no UI
  // path to satisfy it.
  //
  // Visibility is evaluated against the accepted answers, which is the same
  // input the client used, so the two agree. Omitting a trigger answer can only
  // hide a dependent field — it can't smuggle a value past validation, and a
  // required trigger is still enforced on its own.
  const answeredValues: Record<string, AnswerValue | undefined> = {}
  for (const a of accepted) answeredValues[a.fieldId] = a.value

  for (const f of fields) {
    if (!f.required || NON_ANSWER_TYPES.has(f.type) || providedIds.has(f.id)) continue
    if (!isFieldVisible(f.logic ?? undefined, answeredValues)) continue
    return { success: false, error: `Please answer: ${f.label || "a required question"}` }
  }

  // Cheap pre-check so an obviously-closed form rejects without opening a
  // transaction. It is NOT the enforcement point — a count read outside the
  // transaction lets concurrent submits all observe the same under-limit value
  // and all commit. The authoritative re-count happens under an advisory lock
  // inside the transaction below.
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
  //
  // Like the cap above, this read is only a fast path that produces a friendly
  // message. The real guarantee is `submissions_form_respondent_unique_idx`,
  // whose violation is caught after the transaction.
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
  let overLimit = false
  try {
    await db.transaction(async (tx) => {
      // Capped forms serialize here. The count that decides whether this
      // response fits has to be taken while holding something, or N concurrent
      // submits each read "99 of 100" and each commit — the exact failure a
      // load test surfaces. The lock is transaction-scoped (released on commit
      // or rollback) and keyed on the form, so only submissions to the SAME
      // capped form queue; uncapped forms never take it at all.
      if (form.submissionLimit != null) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${form.id}))`)
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(submissions)
          .where(and(eq(submissions.formId, form.id), eq(submissions.status, "completed")))
        if (count >= form.submissionLimit) {
          overLimit = true
          return // nothing written; the tx commits empty
        }
      }

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
          bytes: file.bytes, // already validated + bounded in filesFromValue
        }))
      })
      if (uploadRows.length > 0) await tx.insert(uploads).values(uploadRows)
    })
  } catch (err) {
    // The only unique constraint a submit can trip is
    // submissions_form_respondent_unique_idx, i.e. this respondent raced their
    // own second submission past the pre-check above. That's the rule working,
    // not an error — report it the same way the pre-check does.
    if (isUniqueViolation(err)) {
      return { success: false, error: "You've already responded to this form." }
    }
    console.error("[submitForm] failed", err)
    return { success: false, error: "Couldn't submit your response. Please try again." }
  }
  // Decided inside the transaction, under the advisory lock.
  if (overLimit) return { success: false, error: "This form is closed." }

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
  const wantsIntelligence = intelligenceEnabled(form.aiConfig)

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
      deliverDiscord({ id: form.id, title: form.title }, webhookAnswers),
      syncSubmissionToNotion(
        { id: form.id, workspaceId: form.workspaceId, title: form.title },
        accepted,
        committedId ?? "",
      ),
    ])
    // Post-submission AI summary/screening (opt-in; self-gates on aiConfig).
    // Runs after delivery so a slow model never delays integrations.
    if (wantsIntelligence) await processSubmission(committedId ?? "")
  })

  return { success: true }
}

/**
 * Owner-side submission operations moved to src/lib/core/submissions.ts so the
 * MCP server can reach them too. These stay as the browser's entry point:
 * resolve the caller from the session cookie, then delegate.
 *
 * `submitForm` above does NOT move, and must not. It is the anonymous
 * respondent path: no caller to resolve, identified by publicId rather than by
 * workspace, and it reads request headers for rate limiting and device
 * metadata. An AuthContext has nothing to offer it.
 */
export async function deleteSubmission(submissionId: string): Promise<SubmitResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: 'Not authorized' }
  return submissionsCore.deleteSubmission(session.ctx, submissionId)
}

/**
 * (Re)generate the AI summary/score for one response on demand — powers the
 * "Generate" button in the response detail and lets owners backfill responses
 * collected before they enabled intelligence.
 */
export async function generateSubmissionIntelligence(
  submissionId: string,
): Promise<SubmitResult> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: 'Not authorized' }
  return submissionsCore.generateSubmissionIntelligence(session.ctx, submissionId)
}
