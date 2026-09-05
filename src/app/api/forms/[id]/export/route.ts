import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { answers, formFields, forms, submissions, type AnswerValue } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { verifyExportToken } from "@/lib/mcp/export-token"
import { NON_ANSWER_TYPES } from "@/lib/builder/logic"
import { answerToCell } from "@/lib/submissions/answer-format"
import { csvFileName, csvRow } from "@/lib/submissions/csv"

export const maxDuration = 60

/** Submissions pulled (and streamed) per round-trip. */
const PAGE = 500

/**
 * Which workspace may download this export.
 *
 * Two ways in. A browser session is the ordinary one. A `?token=` handle is for
 * links minted by `makingflow_export_submissions`, where the person opening it
 * may not be signed in at all — that is the whole reason the handle exists.
 *
 * The token names its own form, and it is checked against the requested id
 * rather than trusted to be the right one: a valid handle for form A must not
 * download form B. Its workspace then goes through the SAME tenancy query as a
 * session's, so a signed URL is a shortcut past the login page and nothing more.
 */
async function authorizeExport(request: Request, formId: string): Promise<string | null> {
  const token = new URL(request.url).searchParams.get("token")
  if (token) {
    const grant = verifyExportToken(token)
    if (!grant || grant.formId !== formId) return null
    return grant.workspaceId
  }

  const workspace = await getDefaultWorkspace()
  return workspace?.id ?? null
}

/**
 * CSV export of EVERY completed response to a form.
 *
 * Replaces the old client-side export, which serialized whatever the responses
 * table happened to be holding — and that table is capped at 200 rows. A form
 * with 500 responses exported 200 of them, silently, with no indication the
 * rest existed.
 *
 * Streams in keyset-paginated chunks rather than materializing the whole export:
 * an unbounded `SELECT` plus every answer row would sit in memory at once, and
 * responses are the table that grows without limit.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspaceId = await authorizeExport(request, id)
  if (!workspaceId) return new Response("Unauthorized", { status: 401 })

  // Tenancy: the form must belong to the caller's workspace. Same guard as
  // getFormSubmissions — an id from another tenant is indistinguishable from
  // one that doesn't exist.
  const [form] = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.id, id), eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return new Response("Not found", { status: 404 })

  const fields = await db
    .select({ id: formFields.id, label: formFields.label, type: formFields.type })
    .from(formFields)
    .where(and(eq(formFields.formId, form.id), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  const columns = fields.filter((f) => !NON_ANSWER_TYPES.has(f.type))

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // BOM so Excel opens UTF-8 correctly on Windows.
        controller.enqueue(encoder.encode("﻿"))
        controller.enqueue(
          encoder.encode(csvRow(["Submitted", ...columns.map((c) => c.label || "Untitled")]) + "\n"),
        )

        // Keyset cursor. (created_at, id) is unique and matches the ordering, so
        // pages can't overlap or skip even as new responses arrive mid-export.
        type Cursor = { createdAt: Date; id: string }
        let cursor: Cursor | null = null
        for (;;) {
          // Annotated because `cursor` is both an input to this query and
          // assigned from its result, which TS can't infer through the cycle.
          const page: Cursor[] = await db
            .select({ id: submissions.id, createdAt: submissions.createdAt })
            .from(submissions)
            .where(
              and(
                eq(submissions.formId, form.id),
                eq(submissions.status, "completed"),
                cursor
                  ? or(
                      gt(submissions.createdAt, cursor.createdAt),
                      and(
                        eq(submissions.createdAt, cursor.createdAt),
                        gt(submissions.id, cursor.id),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(asc(submissions.createdAt), asc(submissions.id))
            .limit(PAGE)
          if (page.length === 0) break

          const rows = await db
            .select({
              submissionId: answers.submissionId,
              fieldId: answers.fieldId,
              value: answers.value,
            })
            .from(answers)
            .where(inArray(answers.submissionId, page.map((s) => s.id)))

          const bySubmission = new Map<string, Map<string, AnswerValue>>()
          for (const a of rows) {
            if (!a.fieldId) continue // AI follow-ups have no column
            let byField = bySubmission.get(a.submissionId)
            if (!byField) bySubmission.set(a.submissionId, (byField = new Map()))
            byField.set(a.fieldId, a.value)
          }

          let chunk = ""
          for (const s of page) {
            const byField = bySubmission.get(s.id)
            chunk +=
              csvRow([
                s.createdAt.toISOString(),
                ...columns.map((c) => answerToCell(byField?.get(c.id))),
              ]) + "\n"
          }
          controller.enqueue(encoder.encode(chunk))

          if (page.length < PAGE) break
          const last = page[page.length - 1]
          cursor = { createdAt: last.createdAt, id: last.id }
        }
        controller.close()
      } catch (err) {
        console.error("[export] failed", err)
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFileName(form.title)}"`,
      "cache-control": "no-store",
    },
  })
}
