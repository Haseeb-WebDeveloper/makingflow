import "server-only"

/**
 * Analytics tools.
 *
 * These read aggregates, not answers — counts, rates, distributions — so they
 * sit behind `analytics:read` rather than `submissions:read`. A key can be
 * granted "tell me how the form is performing" without also being granted
 * "read what people wrote", which is the split most automation actually wants.
 *
 * One exception worth naming: per-question text insights include a few sample
 * answers, which ARE respondent text. `get_form_analytics` therefore drops the
 * samples unless the key also holds `submissions:read`.
 */

import * as z from "zod"
import { getFormInsights } from "@/lib/data/form-insights"
import { getFormsDashboard } from "@/lib/data/analytics"
import { DASHBOARD_RANGES } from "@/lib/data/range"
import { defineTool, ToolError, type RegisteredMcpTool } from "@/lib/mcp/define-tool"

const RANGE_KEYS = DASHBOARD_RANGES.map((r) => r.key) as [string, ...string[]]

const bucket = z.array(z.object({ key: z.string(), count: z.number().int() }))

export const analyticsTools: RegisteredMcpTool[] = [
  defineTool({
    name: "makingflow_get_dashboard",
    title: "Workspace analytics",
    description:
      "Workspace-wide performance: total and recent responses, active forms, views, completion rate, a trend series over the chosen range, respondent breakdowns, and a per-form overview.",
    inputSchema: z.object({
      range: z
        .enum(RANGE_KEYS)
        .default("14d")
        .describe(`One of: ${RANGE_KEYS.join(", ")}.`),
    }),
    outputSchema: z.object({
      range: z.string(),
      totals: z.object({
        totalSubmissions: z.number().int(),
        submissionsThisWeek: z.number().int(),
        submissionsPrevWeek: z.number().int(),
        activeForms: z.number().int(),
        totalForms: z.number().int(),
        views: z.number().int(),
        completes: z.number().int(),
        completionRate: z.number().nullable(),
      }),
      series: z.array(z.object({ day: z.string(), count: z.number().int() })),
      breakdowns: z.object({ devices: bucket, countries: bucket, sources: bucket }),
      forms: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          submissions: z.number().int(),
          views: z.number().int(),
          completionRate: z.number().nullable(),
          lastResponseAt: z.string().nullable(),
        }),
      ),
    }),
    scopes: ["analytics:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx, args) {
      const data = await getFormsDashboard(ctx.workspaceId, args.range as never)
      if (!data) throw new ToolError("Could not load workspace analytics")
      return {
        range: data.range,
        totals: data.totals,
        series: data.series,
        breakdowns: data.breakdowns,
        forms: data.forms.map((f) => ({
          id: f.id,
          title: f.title,
          status: f.status,
          submissions: f.submissions,
          views: f.views,
          completionRate: f.completionRate,
          lastResponseAt: f.lastResponseAt ? f.lastResponseAt.toISOString() : null,
        })),
      }
    },
  }),

  defineTool({
    name: "makingflow_get_form_analytics",
    title: "Form analytics",
    description: [
      "One form's funnel and per-question breakdown: views, starts, completions, completion rate, a 14-day trend, respondent device/country/source splits, where people abandon, and how each question was answered.",
      "",
      "Drop-off tells you which question people stop at — usually the most actionable number here.",
      "Free-text sample answers are included only if this key also holds submissions:read, since samples are respondent-written.",
    ].join("\n"),
    inputSchema: z.object({ formId: z.string() }),
    outputSchema: z.object({
      totals: z.object({
        views: z.number().int(),
        uniqueVisitors: z.number().int(),
        starts: z.number().int(),
        submissions: z.number().int(),
        completionRate: z.number().nullable(),
      }),
      series: z.array(z.object({ day: z.string(), count: z.number().int() })),
      breakdowns: z.object({ devices: bucket, countries: bucket, sources: bucket }),
      dropOff: z.object({
        total: z.number().int(),
        fields: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            count: z.number().int(),
            percent: z.number(),
          }),
        ),
      }),
      fields: z.array(z.unknown()).describe("Per-question aggregation."),
    }),
    scopes: ["analytics:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx, args) {
      const data = await getFormInsights(args.formId, ctx.workspaceId)
      if (!data) throw new ToolError("Form not found")

      // Sample answers are respondent text, so they follow the PII scope even
      // though everything else here is an aggregate.
      const mayReadAnswers = ctx.scopes.has("submissions:read")
      const fields = data.fields.map((f) =>
        mayReadAnswers ? f : { ...f, samples: undefined },
      )

      return {
        totals: data.totals,
        series: data.series,
        breakdowns: data.breakdowns,
        dropOff: {
          total: data.dropOff.total,
          fields: data.dropOff.fields.map((f) => ({
            id: f.id,
            label: f.label,
            count: f.count,
            percent: f.percent,
          })),
        },
        fields,
      }
    },
  }),
]
