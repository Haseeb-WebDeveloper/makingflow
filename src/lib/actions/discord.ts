"use server"

/**
 * Discord-notification Server Actions. Logic lives in
 * src/lib/core/notifications.ts, shared with the MCP surface.
 *
 * Note the blank-webhookUrl-means-keep-stored behaviour is in core: the URL is
 * a credential, so the settings form must be able to save an unrelated toggle
 * without round-tripping it through the browser.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as notificationsCore from "@/lib/core/notifications"

type Result = { success: true } | { success: false; error: string }

/** Create or update the form's Discord webhook config. */
export async function saveDiscordWebhook(
  formId: string,
  input: { webhookUrl: string; includeAnswers: boolean; enabled: boolean },
): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return notificationsCore.saveDiscordWebhook(session.ctx, formId, input)
}

/** Remove the form's Discord notification entirely. */
export async function removeDiscordWebhook(formId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return notificationsCore.removeDiscordWebhook(session.ctx, formId)
}
