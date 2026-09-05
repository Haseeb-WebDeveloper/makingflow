"use server"

/**
 * Email-notification Server Actions. Logic lives in
 * src/lib/core/notifications.ts, shared with the MCP surface.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as notificationsCore from "@/lib/core/notifications"

type Result = { success: true } | { success: false; error: string }

/** Create or update the form's single email-notification config. */
export async function saveEmailNotification(
  formId: string,
  input: { recipients: string[] | string; includeAnswers: boolean; enabled: boolean },
): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return notificationsCore.saveEmailNotification(session.ctx, formId, input)
}

/** Remove the form's email notification entirely. */
export async function removeEmailNotification(formId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return notificationsCore.removeEmailNotification(session.ctx, formId)
}
