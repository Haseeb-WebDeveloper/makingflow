import "server-only"

import { and, asc, eq, isNotNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { answers, forms, submissions, type AnswerValue } from "@/lib/db/schema"

/**
 * What a delivery is about, reloaded from the database.
 *
 * WHY RELOAD RATHER THAN SNAPSHOT. A webhook signs the exact bytes it sends, so
 * its payload has to be stored and replayed byte-for-byte. Sheets, Notion,
 * email and Discord sign nothing — they render the answers into a row, a page
 * or a message at send time. Storing a copy for each of them would put four
 * more copies of the respondent's answers in a second table to save a query
 * that costs one indexed read.
 *
 * That matters beyond disk: design note 5 in the schema enumerates where
 * respondent PII lives, and each entry has to earn its place. This keeps the
 * count at one.
 *
 * The cost, stated: an answer edited between the first attempt and a retry
 * would be delivered as edited. Nothing edits stored answers today except the
 * AI enrichment pass, which writes to `submissions` rather than here.
 */

/**
 * What every sender returns. Lives here rather than in webhook-delivery.ts
 * because that module imports the senders, and the contract has to sit below
 * both of them to avoid a cycle.
 *
 * `permanent` marks a failure that retrying cannot fix — no recipients, no
 * connection, a destination that no longer exists. Those retire the delivery
 * immediately instead of burning eight hours of attempts on a certainty.
 */
export type SendOutcome = {
  ok: boolean
  /** Provider status, where the transport has one. Shown to the user. */
  status?: number
  error?: string
  /** Response body, truncated by the caller. For the delivery log. */
  body?: string
  permanent?: boolean
}

export type DeliveryAnswer = { fieldId: string; question: string; value: AnswerValue }

export type DeliveryContent = {
  form: { id: string; workspaceId: string; title: string; publicId: string }
  submission: { id: string; submittedAt: Date }
  answers: DeliveryAnswer[]
}

/**
 * Load a submission and its answers in the shape every sender wants.
 *
 * Returns null when the submission is gone — a delivery whose subject was
 * deleted has nothing left to send, and the caller should retire it rather
 * than retry.
 */
export async function loadDeliveryContent(submissionId: string): Promise<DeliveryContent | null> {
  const [row] = await db
    .select({
      submissionId: submissions.id,
      completedAt: submissions.completedAt,
      createdAt: submissions.createdAt,
      formId: forms.id,
      workspaceId: forms.workspaceId,
      title: forms.title,
      publicId: forms.publicId,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .where(eq(submissions.id, submissionId))
    .limit(1)

  if (!row) return null

  const rows = await db
    .select({
      fieldId: answers.fieldId,
      question: answers.question,
      value: answers.value,
    })
    .from(answers)
    .where(
      and(
        eq(answers.submissionId, submissionId),
        // AI follow-ups carry a null field_id: they have no column in a
        // spreadsheet and no stable identity for a receiver to key on. Every
        // existing sender skips them, and the Sheets backfill says so in as
        // many words — matching that keeps a retry identical to the original.
        isNotNull(answers.fieldId),
      ),
    )
    // Insertion order, which is the order the respondent answered in and the
    // order the first attempt used.
    .orderBy(asc(answers.createdAt))

  return {
    form: {
      id: row.formId,
      workspaceId: row.workspaceId,
      title: row.title,
      publicId: row.publicId,
    },
    submission: {
      id: row.submissionId,
      // completedAt is when the response was finished; createdAt covers rows
      // written before that column existed.
      submittedAt: row.completedAt ?? row.createdAt,
    },
    answers: rows.map((a) => ({
      fieldId: a.fieldId as string,
      question: a.question,
      value: a.value,
    })),
  }
}
