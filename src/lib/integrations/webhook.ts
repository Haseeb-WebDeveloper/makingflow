import "server-only"

import { createHmac } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  type AnswerValue,
  type WebhookIntegrationConfig,
} from "@/lib/db/schema"

export type WebhookAnswer = { fieldId: string; question: string; value: AnswerValue }

export type SubmissionPayload = {
  event: "submission.created"
  form: { id: string; title: string; publicId: string }
  submission: { id: string; submittedAt: string }
  answers: WebhookAnswer[]
}

/** Header carrying the HMAC-SHA256 of the raw body, when a secret is configured. */
export const SIGNATURE_HEADER = "X-MakingFlow-Signature"

type PostResult = { ok: boolean; status?: number; error?: string }

/** POST a JSON body to a webhook URL, signing it if a secret is set. 5s timeout. */
export async function postWebhook(
  url: string,
  body: string,
  secret?: string,
): Promise<PostResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "MakingFlow-Webhook/1.0",
    }
    if (secret) {
      headers[SIGNATURE_HEADER] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
    }
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Best-effort: POST the submission to every enabled webhook on the form. Runs
 * AFTER commit and swallows failures (one retry) — a dead endpoint can't block
 * a respondent. Each endpoint is isolated.
 */
export async function deliverWebhooks(
  form: { id: string; title: string; publicId: string },
  answers: WebhookAnswer[],
  submission: { id: string; submittedAt: Date },
): Promise<void> {
  let rows: { config: WebhookIntegrationConfig }[]
  try {
    const found = await db
      .select({ config: formIntegrations.config })
      .from(formIntegrations)
      .where(
        and(
          eq(formIntegrations.formId, form.id),
          eq(formIntegrations.type, "webhook"),
          eq(formIntegrations.enabled, true),
        ),
      )
    rows = found.map((r) => ({ config: r.config as WebhookIntegrationConfig }))
  } catch (err) {
    console.error("[webhook] could not load endpoints", err)
    return
  }
  if (rows.length === 0) return

  const payload: SubmissionPayload = {
    event: "submission.created",
    form,
    submission: { id: submission.id, submittedAt: submission.submittedAt.toISOString() },
    answers,
  }
  const body = JSON.stringify(payload)

  await Promise.allSettled(
    rows.map(async ({ config }) => {
      const first = await postWebhook(config.url, body, config.secret)
      if (first.ok) return
      const retry = await postWebhook(config.url, body, config.secret)
      if (!retry.ok) {
        console.error(`[webhook] delivery failed for ${config.url}`, retry.error ?? retry.status)
      }
    }),
  )
}
