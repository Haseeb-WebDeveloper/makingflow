import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  type AnswerValue,
  type DiscordIntegrationConfig,
} from "@/lib/db/schema"
import { answerFiles, answerToCell } from "@/lib/submissions/answer-format"

export type DiscordAnswer = { fieldId: string; question: string; value: AnswerValue }

// Discord embed limits we have to respect or the API 400s the request.
const MAX_FIELDS = 25
const MAX_FIELD_NAME = 256
const MAX_FIELD_VALUE = 1024

/** Render an answer for a Discord embed field — uploads become markdown links. */
function cell(value: AnswerValue): string {
  const files = answerFiles(value)
  if (files) {
    return files.map((f) => (f.url ? `[${f.name}](${f.url})` : f.name)).join(", ")
  }
  return answerToCell(value)
}

/** Build the Discord webhook payload: one embed titled with the form name. */
function buildDiscordMessage(
  form: { title: string },
  answers: DiscordAnswer[],
  link: string,
) {
  const fields = answers.slice(0, MAX_FIELDS).map((a) => ({
    name: (a.question || "—").slice(0, MAX_FIELD_NAME),
    value: (cell(a.value) || "—").slice(0, MAX_FIELD_VALUE),
    inline: false,
  }))

  return {
    embeds: [
      {
        title: "New response",
        description: form.title || "Your form",
        url: link || undefined,
        color: 0x0f1a0a,
        ...(fields.length > 0 ? { fields } : {}),
      },
    ],
  }
}

type PostResult = { ok: boolean; status?: number; error?: string }

/** POST a JSON body to a Discord webhook URL. 5s timeout. */
async function postDiscord(url: string, body: string): Promise<PostResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MakingFlow-Discord/1.0",
      },
      body,
      signal: controller.signal,
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Best-effort: post the submission to every enabled Discord webhook on the form.
 * Runs AFTER commit and swallows failures (one retry) — a dead endpoint can't
 * block a respondent. Each endpoint is isolated.
 */
export async function deliverDiscord(
  form: { id: string; title: string },
  answers: DiscordAnswer[],
): Promise<void> {
  let rows: { config: DiscordIntegrationConfig }[]
  try {
    const found = await db
      .select({ config: formIntegrations.config })
      .from(formIntegrations)
      .where(
        and(
          eq(formIntegrations.formId, form.id),
          eq(formIntegrations.type, "discord"),
          eq(formIntegrations.enabled, true),
        ),
      )
    rows = found.map((r) => ({ config: r.config as DiscordIntegrationConfig }))
  } catch (err) {
    console.error("[discord] could not load endpoints", err)
    return
  }
  if (rows.length === 0) return

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || ""
  const link = `${siteUrl}/forms/${form.id}/submissions`

  await Promise.allSettled(
    rows.map(async ({ config }) => {
      const body = JSON.stringify(
        buildDiscordMessage(form, config.includeAnswers ? answers : [], link),
      )
      const first = await postDiscord(config.webhookUrl, body)
      if (first.ok) return
      const retry = await postDiscord(config.webhookUrl, body)
      if (!retry.ok) {
        console.error("[discord] delivery failed", retry.error ?? retry.status)
      }
    }),
  )
}
