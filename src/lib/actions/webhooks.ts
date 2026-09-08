"use server"

/**
 * Webhook Server Actions — the browser's entry point.
 *
 * Thin: resolve the caller from the session cookie, delegate to
 * src/lib/core/webhooks.ts. Signatures unchanged, so no component moved.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as webhooksCore from "@/lib/core/webhooks"

type Result = { success: true } | { success: false; error: string }

/** Add a webhook endpoint to a form. */
export async function addWebhook(
  formId: string,
  input: { url: string; secret?: string },
): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.addWebhook(session.ctx, formId, input)
}

/** Enable/disable a single webhook. */
export async function toggleWebhook(integrationId: string, enabled: boolean): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.toggleWebhook(session.ctx, integrationId, enabled)
}

/** Remove a webhook endpoint. */
export async function removeWebhook(integrationId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.removeWebhook(session.ctx, integrationId)
}

/** Send a sample payload to a webhook so the user can verify their endpoint. */
export async function sendTestWebhook(
  integrationId: string,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return webhooksCore.sendTestWebhook(session.ctx, integrationId)
}
