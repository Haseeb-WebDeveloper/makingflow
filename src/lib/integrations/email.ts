import "server-only"

import { type AnswerValue, type EmailIntegrationConfig } from "@/lib/db/schema"
import { isEmailConfigured, sendEmail } from "@/lib/email/provider"
import { answerFiles, answerToCell } from "@/lib/submissions/answer-format"
import { siteUrl } from "@/lib/docs/site-url"
import type { DeliveryContent, SendOutcome } from "@/lib/integrations/submission-content"

export type EmailAnswer = { question: string; value: AnswerValue }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** The answer cell as HTML — uploads become clickable links, everything else
 * is escaped plain text. */
function cellHtml(value: AnswerValue): string {
  const files = answerFiles(value)
  if (files) {
    return files
      .map((f) =>
        f.url
          ? `<a href="${escapeHtml(f.url)}" style="color:#0f1a0a">${escapeHtml(f.name)}</a>`
          : escapeHtml(f.name),
      )
      .join(", ")
  }
  return escapeHtml(answerToCell(value)) || "—"
}

function buildHtml(title: string, answers: EmailAnswer[], link: string): string {
  const rows = answers
    .map(
      (a) =>
        `<tr><td style="padding:6px 0;color:#5c5c52;font-size:13px;vertical-align:top;width:40%">${escapeHtml(
          a.question || "—",
        )}</td><td style="padding:6px 0;color:#0f1a0a;font-size:13px">${cellHtml(
          a.value,
        )}</td></tr>`,
    )
    .join("")

  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto">
    <h1 style="font-size:18px;color:#0f1a0a;margin:0 0 4px">New response</h1>
    <p style="font-size:14px;color:#5c5c52;margin:0 0 16px">${escapeHtml(title || "Your form")}</p>
    ${rows ? `<table style="width:100%;border-collapse:collapse;border-top:1px solid #e3dfd5">${rows}</table>` : ""}
    <p style="margin:20px 0 0">
      <a href="${link}" style="display:inline-block;background:#0f1a0a;color:#fff;text-decoration:none;font-size:13px;font-weight:500;padding:9px 16px;border-radius:8px">View in MakingFlow</a>
    </p>
  </div>`
}

/**
 * Notify the form's configured recipients about one response.
 *
 * REPORTS its outcome rather than swallowing it. This used to run from after()
 * and console.error a failure, which meant a notification nobody received was
 * also a notification nobody knew about. It is now driven by the delivery
 * queue, so a failure is recorded, retried and visible.
 *
 * At-least-once, deliberately. A send that succeeded but timed out on our side
 * is retried, so a recipient can see the same notification twice. That is the
 * right trade for a notification: a duplicate is mildly annoying, a silently
 * missing one is what people actually complain about. The delivery id goes out
 * as an idempotency key, which removes the duplicate wherever the provider
 * honours one.
 */
export async function sendSubmissionEmail(
  config: EmailIntegrationConfig,
  content: DeliveryContent,
  deliveryId: string,
): Promise<SendOutcome> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email is not configured on this deployment", permanent: true }
  }

  const recipients = config.recipients?.filter(Boolean) ?? []
  if (recipients.length === 0) {
    // No amount of retrying invents a recipient.
    return { ok: false, error: "No recipients configured", permanent: true }
  }

  const link = `${siteUrl()}/forms/${content.form.id}/submissions`
  const html = buildHtml(
    content.form.title,
    config.includeAnswers ? content.answers : [],
    link,
  )

  const res = await sendEmail({
    to: recipients,
    subject: `New response: ${content.form.title || "your form"}`,
    html,
    idempotencyKey: deliveryId,
  })
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
