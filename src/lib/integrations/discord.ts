import "server-only"

import { type AnswerValue, type DiscordIntegrationConfig } from "@/lib/db/schema"
import { answerFiles, answerToCell } from "@/lib/submissions/answer-format"
import { siteUrl } from "@/lib/docs/site-url"
import type { DeliveryContent, SendOutcome } from "@/lib/integrations/submission-content"

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
 * Post one response into the form's Discord channel.
 *
 * REPORTS its outcome rather than swallowing it, and no longer retries inline.
 * The immediate second attempt this used to make helped with none of the real
 * failure modes — Discord being briefly unavailable is measured in seconds, not
 * milliseconds — and the delivery queue now does it properly, with backoff and
 * a record.
 *
 * At-least-once. Discord has no idempotency key and no way to recognise a
 * repeat, so a send that succeeded but timed out on our side becomes a second
 * message in the channel. That is the accepted trade: a duplicate notification
 * is noise, a missing one is a response nobody saw.
 */
export async function deliverDiscord(
  config: DiscordIntegrationConfig,
  content: DeliveryContent,
): Promise<SendOutcome> {
  if (!config.webhookUrl) {
    return { ok: false, error: "No Discord webhook URL configured", permanent: true }
  }

  const link = `${siteUrl()}/forms/${content.form.id}/submissions`
  const body = JSON.stringify(
    buildDiscordMessage(
      { title: content.form.title },
      config.includeAnswers ? content.answers : [],
      link,
    ),
  )

  const res = await postDiscord(config.webhookUrl, body)
  return res.ok
    ? { ok: true, status: res.status }
    : { ok: false, status: res.status, error: res.error }
}
