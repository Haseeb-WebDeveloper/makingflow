import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  type AnswerValue,
  type EmailIntegrationConfig,
} from "@/lib/db/schema"
import { isEmailConfigured, sendEmail } from "@/lib/email/provider"
import { answerFiles, answerToCell } from "@/lib/submissions/answer-format"

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
 * Best-effort: email the configured recipients about a new submission. Runs
 * AFTER commit and swallows failures — a bounce can't block a respondent.
 */
export async function sendSubmissionEmails(
  form: { id: string; title: string },
  answers: EmailAnswer[],
): Promise<void> {
  if (!isEmailConfigured()) return

  let rows: { config: EmailIntegrationConfig }[]
  try {
    const found = await db
      .select({ config: formIntegrations.config })
      .from(formIntegrations)
      .where(
        and(
          eq(formIntegrations.formId, form.id),
          eq(formIntegrations.type, "email"),
          eq(formIntegrations.enabled, true),
        ),
      )
    rows = found.map((r) => ({ config: r.config as EmailIntegrationConfig }))
  } catch (err) {
    console.error("[email] could not load notifications", err)
    return
  }
  if (rows.length === 0) return

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || ""
  const link = `${siteUrl}/forms/${form.id}/submissions`
  const subject = `New response: ${form.title || "your form"}`

  for (const { config } of rows) {
    const recipients = config.recipients?.filter(Boolean) ?? []
    if (recipients.length === 0) continue
    const html = buildHtml(form.title, config.includeAnswers ? answers : [], link)
    const res = await sendEmail({ to: recipients, subject, html })
    if (!res.ok) console.error("[email] send failed", res.error)
  }
}
