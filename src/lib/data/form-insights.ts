import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formFields,
  submissions,
  answers,
  formEvents,
  type AnswerValue,
  type FieldOption,
} from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { channelExpr, lastNDayKeys, SOURCE_CHANNELS, type Bucket } from "@/lib/data/analytics"

const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])
const SINGLE_CHOICE = new Set(["multiple_choice", "dropdown", "yes_no"])
const MULTI_CHOICE = new Set(["checkboxes", "multi_select", "ranking"])
const NUMERIC = new Set(["rating", "scale", "nps"])

export type FieldOptionStat = { label: string; count: number; percent: number }
export type NpsStat = { promoters: number; passives: number; detractors: number; score: number }

export type FieldInsight = {
  id: string
  label: string
  type: string
  responses: number
  fillRate: number | null // responses ÷ submissions
  kind: "choice" | "rating" | "text"
  options?: FieldOptionStat[]
  isMulti?: boolean
  numeric?: {
    average: number
    min: number
    max: number
    distribution: { value: number; count: number }[]
    nps?: NpsStat
  }
  samples?: string[]
}

/** One question's share of abandonment: how many people whose LAST answered
 *  question (on an unfinished draft) was this one — i.e. they stopped here. */
export type DropOffField = {
  id: string
  label: string
  type: string
  count: number // respondents who stopped after answering this question
  percent: number // count ÷ total abandoned
}

export type FormInsights = {
  totals: {
    views: number
    uniqueVisitors: number
    starts: number
    submissions: number
    completionRate: number | null
  }
  series: { day: string; count: number }[]
  breakdowns: { devices: Bucket[]; countries: Bucket[]; sources: Bucket[] }
  /** Where respondents abandon, derived from unfinished (partial) drafts.
   *  `total` is the number of still-unfinished drafts. */
  dropOff: { total: number; fields: DropOffField[] }
  fields: FieldInsight[]
}

/** Funnel stats + respondent breakdowns + per-question answer aggregation for one
 * form. Workspace-scoped. */
export async function getFormInsights(formId: string): Promise<FormInsights | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return null

  const completed = and(eq(submissions.formId, formId), eq(submissions.status, "completed"))
  const metaWhere = and(completed, sql`${submissions.meta} is not null`)

  const [
    funnel,
    subCount,
    series,
    devices,
    countries,
    sources,
    fieldRows,
    answerRows,
    partialAnswerRows,
  ] = await Promise.all([
    db
      .select({
        views: sql<number>`count(*) filter (where ${formEvents.type} = 'view')::int`,
        starts: sql<number>`count(*) filter (where ${formEvents.type} = 'start')::int`,
        completes: sql<number>`count(*) filter (where ${formEvents.type} = 'complete')::int`,
        uniques: sql<number>`count(distinct ${formEvents.visitorKey}) filter (where ${formEvents.type} = 'view')::int`,
      })
      .from(formEvents)
      .where(eq(formEvents.formId, formId)),

    db.select({ n: sql<number>`count(*)::int` }).from(submissions).where(completed),

    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${submissions.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(submissions)
      .where(and(completed, sql`${submissions.createdAt} >= now() - interval '14 days'`))
      .groupBy(sql`date_trunc('day', ${submissions.createdAt})`)
      .orderBy(sql`date_trunc('day', ${submissions.createdAt})`),

    db
      .select({ key: sql<string>`${submissions.meta}->>'device'`, count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(metaWhere, sql`${submissions.meta}->>'device' is not null`))
      .groupBy(sql`${submissions.meta}->>'device'`)
      .orderBy(sql`count(*) desc`),

    db
      .select({ key: sql<string>`${submissions.meta}->>'country'`, count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(metaWhere, sql`${submissions.meta}->>'country' is not null`))
      .groupBy(sql`${submissions.meta}->>'country'`)
      .orderBy(sql`count(*) desc`),

    db
      .select({ key: channelExpr, count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(metaWhere)
      .groupBy(channelExpr)
      .orderBy(sql`count(*) desc`),

    db
      .select({
        id: formFields.id,
        type: formFields.type,
        label: formFields.label,
        options: formFields.options,
        position: formFields.position,
      })
      .from(formFields)
      .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
      .orderBy(formFields.position),

    // Per-question answers — runs in parallel with the aggregations above (not
    // sequentially after) to save a remote round-trip. Used only when the form
    // has answerable fields; the post-processing below guards that.
    db
      .select({ fieldId: answers.fieldId, value: answers.value })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(completed)
      .orderBy(desc(submissions.createdAt)), // recent-first → samples are recent

    // Drop-off: the FURTHEST question each unfinished draft reached — one row
    // per abandoned draft, not one per answer.
    //
    // DISTINCT ON collapses this in the database. Fetching every partial answer
    // and reducing in JS was unbounded: partials accumulate faster than
    // completes (every abandoned fill leaves one) and nothing ever prunes them,
    // so the transfer grew forever while the result stayed one row per draft.
    // `not in (NON_ANSWER)` mirrors the `posById.has()` guard below, so a
    // content block can never win the DISTINCT ON and drop a draft from the
    // tally — the results are identical to the old JS reduction.
    db.execute<{ submission_id: string; field_id: string }>(sql`
      SELECT DISTINCT ON (a.submission_id) a.submission_id, a.field_id
      FROM ${answers} a
      JOIN ${submissions} s ON s.id = a.submission_id
      JOIN ${formFields} ff ON ff.id = a.field_id
      WHERE s.form_id = ${formId}
        AND s.status = 'partial'
        AND ff.deleted_at IS NULL
        AND ff.type NOT IN ('heading', 'paragraph', 'image', 'embed', 'page_break')
      ORDER BY a.submission_id, ff.position DESC
    `),
  ])

  const submissionsCount = subCount[0]?.n ?? 0
  const f = funnel[0]
  const views = f?.views ?? 0
  const completes = f?.completes ?? 0

  const dayKeys = lastNDayKeys(14)
  const seriesMap = new Map(series.map((r) => [r.day, r.count]))
  const filledSeries = dayKeys.map((d) => ({ day: d, count: seriesMap.get(d) ?? 0 }))

  const srcMap = new Map(sources.map((r) => [r.key, r.count]))
  const filledSources = SOURCE_CHANNELS.map((c) => ({ key: c, count: srcMap.get(c) ?? 0 })).sort(
    (a, b) => b.count - a.count,
  )

  // Per-question answers. JS aggregation over fetched rows is fine at current
  // volume; SQL-side aggregation is the future optimization for very busy forms.
  const answerable = fieldRows.filter((r) => !NON_ANSWER.has(r.type))
  let fields: FieldInsight[] = []
  if (answerable.length > 0) {
    const byField = new Map<string, AnswerValue[]>()
    for (const r of answerRows) {
      if (!r.fieldId) continue
      const arr = byField.get(r.fieldId)
      if (arr) arr.push(r.value)
      else byField.set(r.fieldId, [r.value])
    }
    fields = answerable.map((field) =>
      buildFieldInsight(field, byField.get(field.id) ?? [], submissionsCount),
    )
  }

  // Drop-off: for each unfinished draft, find the furthest question it answered
  // (highest position among answerable fields) — that's where the respondent
  // stopped. Tally how many stopped at each question; percent is of all drafts.
  // One row per abandoned draft, already reduced to its furthest question by
  // the DISTINCT ON above — this just tallies them.
  const posById = new Map(answerable.map((r) => [r.id, r.position]))
  const stoppedAt = new Map<string, number>()
  let abandoned = 0
  for (const r of partialAnswerRows) {
    // Guards against a field that is soft-deleted or otherwise absent from the
    // answerable set between the two queries.
    if (!r.field_id || !posById.has(r.field_id)) continue
    stoppedAt.set(r.field_id, (stoppedAt.get(r.field_id) ?? 0) + 1)
    abandoned++
  }
  const dropOffFields: DropOffField[] = answerable.map((f) => {
    const count = stoppedAt.get(f.id) ?? 0
    return {
      id: f.id,
      label: f.label || "Untitled question",
      type: f.type,
      count,
      percent: abandoned > 0 ? count / abandoned : 0,
    }
  })

  return {
    totals: {
      views,
      uniqueVisitors: f?.uniques ?? 0,
      starts: f?.starts ?? 0,
      submissions: submissionsCount,
      completionRate: views > 0 ? completes / views : null,
    },
    series: filledSeries,
    breakdowns: { devices, countries, sources: filledSources },
    dropOff: { total: abandoned, fields: dropOffFields },
    fields,
  }
}

function isEmptyValue(v: AnswerValue): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0)
}

type FieldRow = {
  id: string
  type: string
  label: string
  options: FieldOption[] | null
}

function buildFieldInsight(
  field: FieldRow,
  values: AnswerValue[],
  submissionsCount: number,
): FieldInsight {
  const type = field.type
  const nonEmpty = values.filter((v) => !isEmptyValue(v))
  const responses = nonEmpty.length
  const fillRate = submissionsCount > 0 ? responses / submissionsCount : null
  const base = { id: field.id, label: field.label || "Untitled question", type, responses, fillRate }

  if (NUMERIC.has(type)) {
    const nums = nonEmpty.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    if (nums.length === 0) return { ...base, kind: "rating" }
    const sum = nums.reduce((s, n) => s + n, 0)
    const [lo, hi] = type === "nps" ? [0, 10] : [1, 5]
    const distMap = new Map<number, number>()
    for (let i = lo; i <= hi; i++) distMap.set(i, 0)
    for (const n of nums) distMap.set(n, (distMap.get(n) ?? 0) + 1)
    const distribution = [...distMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([value, count]) => ({ value, count }))
    let nps: NpsStat | undefined
    if (type === "nps") {
      const promoters = nums.filter((n) => n >= 9).length
      const detractors = nums.filter((n) => n <= 6).length
      const passives = nums.length - promoters - detractors
      nps = {
        promoters,
        passives,
        detractors,
        score: Math.round((promoters / nums.length - detractors / nums.length) * 100),
      }
    }
    return {
      ...base,
      kind: "rating",
      numeric: { average: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums), distribution, nps },
    }
  }

  if (SINGLE_CHOICE.has(type) || MULTI_CHOICE.has(type)) {
    const isMulti = MULTI_CHOICE.has(type)
    const counts = new Map<string, number>()
    const bump = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1)
    for (const v of nonEmpty) {
      if (Array.isArray(v)) v.forEach((x) => bump(String(x)))
      else bump(String(v))
    }
    const defined = type === "yes_no" ? ["Yes", "No"] : (field.options ?? []).map((o) => o.label)
    const denom = responses || 1
    const seen = new Set<string>()
    const options: FieldOptionStat[] = []
    for (const label of defined) {
      seen.add(label)
      const count = counts.get(label) ?? 0
      options.push({ label, count, percent: count / denom })
    }
    for (const [label, count] of counts) {
      if (!seen.has(label)) options.push({ label, count, percent: count / denom })
    }
    return { ...base, kind: "choice", isMulti, options }
  }

  // Text and other free-form types: count + a few recent samples.
  const samples = nonEmpty
    .filter((v) => typeof v === "string" && v.trim() !== "")
    .slice(0, 3)
    .map((v) => String(v))
  return { ...base, kind: "text", samples }
}
