import "server-only"

import { generateObject } from "ai"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { answers, forms, submissions, type AnswerValue } from "@/lib/db/schema"
import { aiModel, isAiConfigured } from "@/lib/ai/provider"
import { incrementAiCalls } from "@/lib/usage/meter"

/**
 * Post-submission AI intelligence (PRODUCT.md §6.6 / FORM_BUILDER §4.5).
 *
 * Two single-shot, structured-output calls, run only when the form owner has
 * opted in (both off by default):
 *   - summary:   a short owner-facing recap of one response.
 *   - screening: a 0-100 fit score + one-line reason against owner criteria.
 *
 * Everything here is best-effort and additive: it never blocks a submission,
 * never throws to its caller, and no-ops when no Gemini key is configured —
 * a form must still collect responses with AI unavailable.
 */

/** Flatten one answer value into a readable line for the model. */
function formatValue(v: AnswerValue | null | undefined): string {
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "object") {
    // File-upload/signature values store { files: [{ name, url }] }.
    const files = (v as { files?: { name?: string }[] }).files
    if (Array.isArray(files)) return files.map((f) => f?.name ?? "file").join(", ")
    return JSON.stringify(v)
  }
  return String(v)
}

function buildTranscript(rows: { question: string; value: AnswerValue }[]): string {
  return rows
    .map((r) => {
      const val = formatValue(r.value).trim()
      return `Q: ${r.question || "(untitled)"}\nA: ${val || "(no answer)"}`
    })
    .join("\n\n")
}

async function summarizeSubmission(transcript: string, formTitle: string): Promise<string | null> {
  try {
    const { object } = await generateObject({
      model: aiModel,
      schema: z.object({ summary: z.string() }),
      system:
        "You write a concise summary of a single form response for the form's owner. " +
        "2-3 sentences, neutral and factual, highlighting the most useful points. " +
        "No preamble, no markdown, no bullet lists — just the summary text.",
      prompt: `Form: "${formTitle}"\n\nResponse:\n${transcript}\n\nSummarize this response.`,
    })
    return object.summary.trim() || null
  } catch (err) {
    console.error("[summarizeSubmission] failed", err)
    return null
  }
}

async function screenSubmission(
  transcript: string,
  formTitle: string,
  criteria: string,
): Promise<{ score: number; reason: string } | null> {
  try {
    const { object } = await generateObject({
      model: aiModel,
      schema: z.object({
        score: z.number().int().min(0).max(100),
        reason: z.string(),
      }),
      system:
        "You screen a single form response against the owner's criteria. " +
        "Return a fit score from 0 (poor fit) to 100 (excellent fit) and one concise " +
        "sentence explaining the score. Judge only against the stated criteria.",
      prompt: `Screening criteria:\n${criteria}\n\nForm: "${formTitle}"\n\nResponse:\n${transcript}\n\nScore this response against the criteria.`,
    })
    // Clamp defensively — the model is instructed to stay in range, but never
    // persist an out-of-range score.
    const score = Math.max(0, Math.min(100, Math.round(object.score)))
    return { score, reason: object.reason.trim() }
  } catch (err) {
    console.error("[screenSubmission] failed", err)
    return null
  }
}

/**
 * Generate + persist AI summary/score for one completed submission, honoring the
 * form's aiConfig opt-ins. Safe to call from `after()` (post-submit) or from the
 * owner-triggered "Generate" action. Returns the fields written (or null).
 */
export async function processSubmission(
  submissionId: string,
): Promise<{ aiSummary?: string; aiScore?: number; aiScreenReason?: string } | null> {
  if (!submissionId) return null
  if (!isAiConfigured()) return null // graceful: AI unavailable

  try {
    const [sub] = await db
      .select({
        id: submissions.id,
        formId: submissions.formId,
        workspaceId: submissions.workspaceId,
        status: submissions.status,
      })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1)
    if (!sub || sub.status !== "completed") return null

    const [form] = await db
      .select({ title: forms.title, aiConfig: forms.aiConfig })
      .from(forms)
      .where(eq(forms.id, sub.formId))
      .limit(1)
    if (!form) return null

    const cfg = form.aiConfig ?? {}
    const criteria = cfg.screeningCriteria?.trim()
    const wantSummary = !!cfg.summaryEnabled
    const wantScreen = !!cfg.screeningEnabled && !!criteria
    if (!wantSummary && !wantScreen) return null

    const rows = await db
      .select({ question: answers.question, value: answers.value })
      .from(answers)
      .where(eq(answers.submissionId, submissionId))
      .orderBy(answers.createdAt)
    if (rows.length === 0) return null

    const transcript = buildTranscript(rows)

    const [summary, screen] = await Promise.all([
      wantSummary ? summarizeSubmission(transcript, form.title) : Promise.resolve(null),
      wantScreen ? screenSubmission(transcript, form.title, criteria!) : Promise.resolve(null),
    ])

    const set: Partial<{ aiSummary: string; aiScore: number; aiScreenReason: string }> = {}
    if (summary) set.aiSummary = summary
    if (screen) {
      set.aiScore = screen.score
      set.aiScreenReason = screen.reason
    }
    if (Object.keys(set).length === 0) return null

    await db.update(submissions).set(set).where(eq(submissions.id, submissionId))

    // Meter the model calls we actually made (summary + screen = up to 2).
    const calls = (summary ? 1 : 0) + (screen ? 1 : 0)
    if (calls > 0) await incrementAiCalls(sub.workspaceId, calls)

    return set
  } catch (err) {
    console.error("[processSubmission] failed", err)
    return null
  }
}

/** Whether a form's config has at least one intelligence feature enabled. */
export function intelligenceEnabled(aiConfig: {
  summaryEnabled?: boolean
  screeningEnabled?: boolean
  screeningCriteria?: string
} | null | undefined): boolean {
  if (!aiConfig) return false
  return (
    !!aiConfig.summaryEnabled ||
    (!!aiConfig.screeningEnabled && !!aiConfig.screeningCriteria?.trim())
  )
}
