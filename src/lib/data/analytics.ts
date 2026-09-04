import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, submissions, formEvents } from "@/lib/db/schema"
import {
  DEFAULT_RANGE,
  rangeBuckets,
  type DashboardRange,
} from "@/lib/data/range"

export type FormOverviewRow = {
  id: string
  title: string
  status: string
  folderId: string | null
  updatedAt: Date
  submissions: number
  views: number
  lastResponseAt: Date | null
  completionRate: number | null // completes ÷ views, or null when no views
  /** Submission counts per bucket over the selected range (zero-filled). */
  spark: number[]
}

/** Canonical marketing channels — always shown (0-filled) so users know the set. */
export const SOURCE_CHANNELS = ["Direct", "Search", "Social", "Referral", "Email", "Paid"] as const

export type Bucket = { key: string; count: number }

// Re-exported so existing callers (and the range picker) have one import path.
export {
  DASHBOARD_RANGES,
  DEFAULT_RANGE,
  lastNDayKeys,
  parseRange,
  rangeBuckets,
  type DashboardRange,
} from "@/lib/data/range"

/**
 * The three groupings a range can ask for, written out rather than built from
 * the bucket name. `date_trunc`'s unit cannot be a bind parameter, and writing
 * all three literally means no part of a query is ever assembled from a value
 * that reached us through a URL.
 */
const BUCKET_EXPR = {
  day: sql`date_trunc('day', ${submissions.createdAt})`,
  week: sql`date_trunc('week', ${submissions.createdAt})`,
  month: sql`date_trunc('month', ${submissions.createdAt})`,
} as const

// Shared submission-metadata SQL expressions (referrer/UTM → marketing channel),
// reused by the workspace dashboard and the per-form insights.
const metaHost = sql`lower(coalesce(nullif(regexp_replace(split_part(split_part(${submissions.meta}->>'referrer', '://', 2), '/', 1), '^www\\.', ''), ''), ''))`
const metaUtmMedium = sql`lower(coalesce(${submissions.meta}->'urlParams'->>'utm_medium', ''))`
const metaUtmSource = sql`lower(coalesce(${submissions.meta}->'urlParams'->>'utm_source', ''))`
export const channelExpr = sql<string>`case
  when ${metaUtmMedium} in ('cpc','ppc','paid','paidsearch','paid_social','display','cpm') then 'Paid'
  when ${metaUtmMedium} in ('email','newsletter') or ${metaUtmSource} like '%newsletter%' or ${metaUtmSource} like '%email%' then 'Email'
  when ${metaHost} ~ '(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia)' then 'Search'
  when ${metaHost} ~ '(t\\.co|twitter|x\\.com|facebook|instagram|linkedin|lnkd|reddit|youtube|tiktok|pinterest|whatsapp|telegram)' then 'Social'
  when ${metaHost} = '' then 'Direct'
  else 'Referral'
end`

export type FormsDashboard = {
  totals: {
    totalSubmissions: number
    submissionsThisWeek: number
    submissionsPrevWeek: number
    activeForms: number
    totalForms: number
    views: number
    completes: number
    completionRate: number | null
  }
  /** Completed submissions per bucket over the selected range (zero-filled). */
  series: { day: string; count: number }[]
  /** Echoed back so the caller can label the axis without re-deriving it. */
  range: DashboardRange
  /** Respondent breakdowns from submission metadata (captured going forward). */
  breakdowns: {
    devices: Bucket[]
    countries: Bucket[]
    sources: Bucket[]
  }
  forms: FormOverviewRow[]
}

const EMPTY: FormsDashboard = {
  totals: {
    totalSubmissions: 0,
    submissionsThisWeek: 0,
    submissionsPrevWeek: 0,
    activeForms: 0,
    totalForms: 0,
    views: 0,
    completes: 0,
    completionRate: null,
  },
  series: [],
  range: DEFAULT_RANGE,
  breakdowns: { devices: [], countries: [], sources: [] },
  forms: [],
}

/**
 * Everything the /forms home page needs: workspace stat cards, a trend series
 * over the requested range, and a per-form overview (submissions, views, completion). Submission
 * counts come from the `submissions` table (source of truth); views/completes
 * from the `form_events` funnel.
 */
export async function getFormsDashboard(
  // Explicit, not session-resolved — see getFormInsights for why.
  workspaceId: string,
  range: DashboardRange = DEFAULT_RANGE,
): Promise<FormsDashboard | null> {

  const formRows = await db
    .select({
      id: forms.id,
      title: forms.title,
      status: forms.status,
      folderId: forms.folderId,
      updatedAt: forms.updatedAt,
    })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .orderBy(desc(forms.updatedAt))

  const totalForms = formRows.length
  const activeForms = formRows.filter((f) => f.status === "published").length
  // Carry the range through even with nothing to show, so the picker still
  // reflects what the user chose.
  if (totalForms === 0) return { ...EMPTY, range }

  const formIds = formRows.map((f) => f.id)

  // "All time" is the only range that has to ask where the data starts, so it
  // is the only one that pays for the extra round trip.
  const earliest =
    range === "all"
      ? ((
          await db
            .select({ min: sql<Date | null>`min(${submissions.createdAt})` })
            .from(submissions)
            .where(
              and(
                eq(submissions.workspaceId, workspaceId),
                eq(submissions.status, "completed"),
              ),
            )
        )[0]?.min ?? null)
      : null

  const { keys: bucketKeys, from, bucket } = rangeBuckets(
    range,
    earliest ? new Date(earliest) : null,
  )
  const bucketExpr = BUCKET_EXPR[bucket]

  // Breakdowns are scoped to completed submissions that actually carry metadata,
  // so percentages are computed within the tracked population.
  const metaWhere = and(
    eq(submissions.workspaceId, workspaceId),
    eq(submissions.status, "completed"),
    sql`${submissions.meta} is not null`,
  )

  const [subAgg, evAgg, winRows, series, perFormSeries, devices, countries, sources] =
    await Promise.all([
    db
      .select({
        formId: submissions.formId,
        count: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${submissions.createdAt})`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.workspaceId, workspaceId),
          eq(submissions.status, "completed"),
        ),
      )
      .groupBy(submissions.formId),

    db
      .select({
        formId: formEvents.formId,
        views: sql<number>`count(*) filter (where ${formEvents.type} = 'view')::int`,
        completes: sql<number>`count(*) filter (where ${formEvents.type} = 'complete')::int`,
      })
      .from(formEvents)
      .where(inArray(formEvents.formId, formIds))
      .groupBy(formEvents.formId),

    db
      .select({
        total: sql<number>`count(*)::int`,
        week: sql<number>`count(*) filter (where ${submissions.createdAt} >= now() - interval '7 days')::int`,
        prev: sql<number>`count(*) filter (where ${submissions.createdAt} >= now() - interval '14 days' and ${submissions.createdAt} < now() - interval '7 days')::int`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.workspaceId, workspaceId),
          eq(submissions.status, "completed"),
        ),
      ),

    db
      .select({
        day: sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.workspaceId, workspaceId),
          eq(submissions.status, "completed"),
          gte(submissions.createdAt, from),
        ),
      )
      .groupBy(bucketExpr)
      .orderBy(bucketExpr),

    db
      .select({
        formId: submissions.formId,
        day: sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.workspaceId, workspaceId),
          eq(submissions.status, "completed"),
          gte(submissions.createdAt, from),
        ),
      )
      .groupBy(submissions.formId, bucketExpr),

    db
      .select({
        key: sql<string>`${submissions.meta}->>'device'`,
        count: sql<number>`count(*)::int`,
      })
      .from(submissions)
      .where(and(metaWhere, sql`${submissions.meta}->>'device' is not null`))
      .groupBy(sql`${submissions.meta}->>'device'`)
      .orderBy(sql`count(*) desc`),

    db
      .select({
        key: sql<string>`${submissions.meta}->>'country'`,
        count: sql<number>`count(*)::int`,
      })
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
  ])

  const subMap = new Map(subAgg.map((r) => [r.formId, r]))
  const evMap = new Map(evAgg.map((r) => [r.formId, r]))

  // form id → (day → count)
  const perForm = new Map<string, Map<string, number>>()
  for (const r of perFormSeries) {
    let m = perForm.get(r.formId)
    if (!m) perForm.set(r.formId, (m = new Map()))
    m.set(r.day, r.count)
  }

  let views = 0
  let completes = 0
  const formsOut: FormOverviewRow[] = formRows.map((f) => {
    const s = subMap.get(f.id)
    const e = evMap.get(f.id)
    const v = e?.views ?? 0
    const c = e?.completes ?? 0
    views += v
    completes += c
    const fm = perForm.get(f.id)
    return {
      id: f.id,
      title: f.title,
      status: f.status,
      folderId: f.folderId,
      updatedAt: f.updatedAt,
      submissions: s?.count ?? 0,
      views: v,
      lastResponseAt: s?.last ? new Date(s.last) : null,
      completionRate: v > 0 ? c / v : null,
      spark: bucketKeys.map((d) => fm?.get(d) ?? 0),
    }
  })

  // Zero-fill so the line stays continuous: a bucket with no submissions has
  // no row to group, and joining across the gap would imply activity there.
  const seriesMap = new Map(series.map((r) => [r.day, r.count]))
  const filledSeries = bucketKeys.map((d) => ({ day: d, count: seriesMap.get(d) ?? 0 }))

  // Always surface every channel (0-fill) so users see what we track.
  const srcMap = new Map(sources.map((r) => [r.key, r.count]))
  const filledSources = SOURCE_CHANNELS.map((c) => ({ key: c, count: srcMap.get(c) ?? 0 })).sort(
    (a, b) => b.count - a.count,
  )

  const win = winRows[0]
  return {
    totals: {
      totalSubmissions: win?.total ?? 0,
      submissionsThisWeek: win?.week ?? 0,
      submissionsPrevWeek: win?.prev ?? 0,
      activeForms,
      totalForms,
      views,
      completes,
      completionRate: views > 0 ? completes / views : null,
    },
    series: filledSeries,
    range,
    breakdowns: { devices, countries, sources: filledSources },
    forms: formsOut,
  }
}
