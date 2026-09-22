import "server-only"

/**
 * Which rows an export contains, and what is attached to each.
 *
 * KEYSET, NOT OFFSET. `(created_at, id)` is unique and matches the ordering, so
 * pages cannot overlap or skip while responses keep arriving mid-export — the
 * same cursor `getFormSubmissionsPage` uses, for the same reason.
 *
 * FILTERS RUN IN JS, ON PURPOSE (design note D2). `applyFilters` is the exact
 * function the responses table uses, so "export what I filtered" cannot drift
 * from what the owner was looking at. Status, date range and ordering push down
 * into SQL because Postgres can index them; jsonb answer conditions do not.
 *
 * The consequence is that `limit` is applied AFTER filtering, in this
 * generator, and that `countExportRows` is a pre-filter upper bound. Both are
 * deliberate: "most recent 50 of the ones I filtered" is what the dialog
 * promises, and an over-count only ever pushes an export to the safer path.
 */

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  answers,
  formFields,
  forms,
  submissions,
  type AnswerValue,
  type SubmissionMeta,
} from "@/lib/db/schema"
import { NON_ANSWER_TYPES } from "@/lib/builder/logic"
import { applyFilters, type FilterColumn } from "@/lib/submissions/filter"
import { answerFiles } from "@/lib/submissions/answer-format"
import { archiveEntryName } from "@/lib/submissions/export-media"
import { buildColumns, type ColumnSources, type ExportColumn } from "@/lib/submissions/export-columns"
import { safeTimezone, type ExportSpec } from "@/lib/submissions/export-spec"
import type { ExportFileRef, ExportSubmission } from "@/lib/submissions/export-row"

/** Submissions pulled per round-trip. */
export const PAGE = 500

export type ExportSource = {
  form: { id: string; title: string }
  columns: ExportColumn[]
  sources: ColumnSources
  rows: AsyncGenerator<ExportSubmission>
}

/** Tenancy check plus the title, or null if the caller may not see this form. */
async function ownedForm(formId: string, workspaceId: string) {
  const [form] = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  return form ?? null
}

/** The SQL-pushable part of a scope: status and date range. */
function scopePredicate(formId: string, spec: ExportSpec) {
  const parts = [eq(submissions.formId, formId)]
  if (spec.scope.status === "completed") parts.push(eq(submissions.status, "completed"))
  // `gte`/`lte` rather than a raw sql template: the template binds a Date as a
  // plain parameter and postgres.js rejects it, because only the operator form
  // runs the column's own type mapper.
  if (spec.scope.from) {
    parts.push(gte(submissions.createdAt, new Date(`${spec.scope.from}T00:00:00.000Z`)))
  }
  if (spec.scope.to) {
    parts.push(lte(submissions.createdAt, new Date(`${spec.scope.to}T23:59:59.999Z`)))
  }
  return and(...parts)!
}

/**
 * How many rows the scope holds before answer filters are applied.
 *
 * This is what decides stream-or-queue, so it is deliberately an UPPER bound:
 * counting the filtered set would mean reading every answer twice.
 */
export async function countExportRows(formId: string, spec: ExportSpec): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(scopePredicate(formId, spec))
  return row?.count ?? 0
}

/** Live answer fields in form order. */
async function liveFields(formId: string) {
  const fields = await db
    .select({
      id: formFields.id,
      label: formFields.label,
      type: formFields.type,
      options: formFields.options,
    })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  return fields.filter((f) => !NON_ANSWER_TYPES.has(f.type))
}

/**
 * Labels of answers in scope whose field is gone — deleted outright (field_id
 * nulled by the FK) or soft-deleted. `answers.question` is what survives, which
 * is the only reason this history is recoverable at all.
 */
async function removedQuestionLabels(formId: string, spec: ExportSpec): Promise<string[]> {
  const rows = await db
    .select({ question: answers.question })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .leftJoin(formFields, eq(answers.fieldId, formFields.id))
    .where(
      and(
        scopePredicate(formId, spec),
        eq(answers.isAiFollowUp, false),
        or(isNull(answers.fieldId), sql`${formFields.deletedAt} is not null`),
      ),
    )
    .groupBy(answers.question)
    .orderBy(answers.question)
  return rows.map((r) => r.question)
}

/** The most AI follow-ups any one submission in scope carries. */
async function maxFollowUps(formId: string, spec: ExportSpec): Promise<number> {
  const per = db
    .select({ n: sql<number>`count(*)::int`.as("n") })
    .from(answers)
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(and(scopePredicate(formId, spec), eq(answers.isAiFollowUp, true)))
    .groupBy(answers.submissionId)
    .as("per")
  const [row] = await db.select({ max: sql<number>`coalesce(max(${per.n}), 0)::int` }).from(per)
  return row?.max ?? 0
}

export async function openExport(
  formId: string,
  workspaceId: string,
  spec: ExportSpec,
): Promise<ExportSource | null> {
  const form = await ownedForm(formId, workspaceId)
  if (!form) return null

  const fields = await liveFields(formId)
  const sources: ColumnSources = {
    fields,
    removedQuestions: spec.columns.removedQuestions
      ? await removedQuestionLabels(formId, spec)
      : [],
    followUpCount: spec.columns.aiFollowUps ? await maxFollowUps(formId, spec) : 0,
    timezone: safeTimezone(spec.timezone),
  }
  const columns = buildColumns(spec, sources)

  const filterColumns: FilterColumn[] = fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    options: (f.options as FilterColumn["options"]) ?? null,
  }))

  return { form, columns, sources, rows: streamRows(formId, spec, filterColumns) }
}

type Cursor = { createdAt: Date; id: string }

type SubmissionRow = {
  id: string
  createdAt: Date
  completedAt: Date | null
  status: "partial" | "completed"
  language: string | null
  mode: "classic" | "conversational"
  reviewStatus: "new" | "reviewing" | "done"
  tags: string[] | null
  aiSummary: string | null
  aiScore: number | null
  aiScreenReason: string | null
  calculations: Record<string, number> | null
  meta: unknown
}

function cursorPredicate(cursor: Cursor | null, newest: boolean) {
  if (!cursor) return undefined
  return newest
    ? or(
        lt(submissions.createdAt, cursor.createdAt),
        and(eq(submissions.createdAt, cursor.createdAt), lt(submissions.id, cursor.id)),
      )
    : or(
        gt(submissions.createdAt, cursor.createdAt),
        and(eq(submissions.createdAt, cursor.createdAt), gt(submissions.id, cursor.id)),
      )
}

async function* streamRows(
  formId: string,
  spec: ExportSpec,
  filterColumns: FilterColumn[],
): AsyncGenerator<ExportSubmission> {
  const newest = spec.scope.order === "newest"
  const limit = spec.scope.limit ?? Infinity
  let emitted = 0
  let cursor: Cursor | null = null

  for (;;) {
    // Annotated because `cursor` is both an input to this query and assigned
    // from its result, which TS cannot infer through the cycle.
    const page: SubmissionRow[] = await db
      .select({
        id: submissions.id,
        createdAt: submissions.createdAt,
        completedAt: submissions.completedAt,
        status: submissions.status,
        language: submissions.language,
        mode: submissions.mode,
        reviewStatus: submissions.reviewStatus,
        tags: submissions.tags,
        aiSummary: submissions.aiSummary,
        aiScore: submissions.aiScore,
        aiScreenReason: submissions.aiScreenReason,
        calculations: submissions.calculations,
        meta: submissions.meta,
      })
      .from(submissions)
      .where(and(scopePredicate(formId, spec), cursorPredicate(cursor, newest)))
      .orderBy(
        newest ? desc(submissions.createdAt) : asc(submissions.createdAt),
        newest ? desc(submissions.id) : asc(submissions.id),
      )
      .limit(PAGE)
    if (page.length === 0) return

    const attached = await answersFor(page.map((s) => s.id))
    // The table's own filter, over the same shape it filters in the browser.
    const kept = applyFilters(
      page.map((s) => ({ id: s.id, submittedAt: "", values: attached.get(s.id)?.values ?? {} })),
      filterColumns,
      { search: spec.scope.search ?? "", filters: spec.scope.filters, match: spec.scope.match },
    )
    const keptIds = new Set(kept.map((r) => r.id))

    for (const s of page) {
      if (!keptIds.has(s.id)) continue
      const extra = attached.get(s.id)
      yield {
        ...s,
        tags: s.tags ?? [],
        meta: (s.meta as SubmissionMeta | null) ?? null,
        values: extra?.values ?? {},
        removed: extra?.removed ?? {},
        followUps: extra?.followUps ?? [],
        files: extra?.files ?? [],
      }
      emitted += 1
      if (emitted >= limit) return
    }

    if (page.length < PAGE) return
    const last = page[page.length - 1]
    cursor = { createdAt: last.createdAt, id: last.id }
  }
}

type Attached = {
  values: Record<string, AnswerValue>
  removed: Record<string, AnswerValue>
  followUps: { question: string; answer: string }[]
  files: ExportFileRef[]
}

/** Every answer for one page, split into the four things a row needs. */
async function answersFor(ids: string[]): Promise<Map<string, Attached>> {
  const rows = await db
    .select({
      submissionId: answers.submissionId,
      fieldId: answers.fieldId,
      question: answers.question,
      value: answers.value,
      isAiFollowUp: answers.isAiFollowUp,
      fieldDeletedAt: formFields.deletedAt,
    })
    .from(answers)
    .leftJoin(formFields, eq(answers.fieldId, formFields.id))
    .where(inArray(answers.submissionId, ids))
    .orderBy(asc(answers.createdAt), asc(answers.id))

  const out = new Map<string, Attached>()
  for (const a of rows) {
    let bucket = out.get(a.submissionId)
    if (!bucket) out.set(a.submissionId, (bucket = { values: {}, removed: {}, followUps: [], files: [] }))

    if (a.isAiFollowUp) {
      bucket.followUps.push({ question: a.question, answer: String(a.value ?? "") })
      continue
    }
    if (!a.fieldId || a.fieldDeletedAt) {
      bucket.removed[a.question] = a.value
      continue
    }
    bucket.values[a.fieldId] = a.value

    for (const f of answerFiles(a.value) ?? []) {
      // `path` is this file's entry name inside a media archive, which is what
      // makes the Files column usable: a row in the CSV names the file to open
      // in the zip. Without a storage key we cannot archive it at all, so the
      // delivery URL stands in — still something real to click.
      bucket.files.push({
        path: f.storageKey ? archiveEntryName(f.storageKey, f.name, f.url) : f.url,
        url: f.url,
        name: f.name,
        storageKey: f.storageKey,
        mime: f.mime,
      })
    }
  }
  return out
}
