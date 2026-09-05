"use server"

/**
 * Google Sheets / Notion Server Actions — the browser's entry point.
 *
 * Logic lives in src/lib/core/integrations.ts, shared with the MCP surface.
 * Note that CONNECTING a provider is not here and cannot be: it is an OAuth
 * redirect handled by /api/integrations/{google,notion}/connect, which needs a
 * browser. These actions manage sync for an already-connected workspace.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as integrationsCore from "@/lib/core/integrations"

type Result = { success: true } | { success: false; error: string }

/** Resume / create a form's Google Sheets sync. */
export async function enableFormSheet(formId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.enableFormSheet(session.ctx, formId)
}

/** Pause Sheets sync for a single form (keeps the spreadsheet for later). */
export async function pauseFormSheet(formId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.pauseFormSheet(session.ctx, formId)
}

/** Disconnect the workspace's Google account — the global off-switch. */
export async function disconnectGoogle(returnFormId?: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.disconnectGoogle(session.ctx, returnFormId)
}

/** Resume / create a form's Notion sync. */
export async function enableFormNotion(formId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.enableFormNotion(session.ctx, formId)
}

/** Pause Notion sync for a single form. */
export async function pauseFormNotion(formId: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.pauseFormNotion(session.ctx, formId)
}

/** Disconnect the workspace's Notion account. */
export async function disconnectNotion(returnFormId?: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.disconnectNotion(session.ctx, returnFormId)
}
