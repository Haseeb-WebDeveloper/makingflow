/**
 * Email and Discord notification configs for a form.
 *
 * One module because they are the same operation with different payloads: a
 * single upserted row per form, carrying where to send a copy of each response.
 *
 * THE DISCORD URL IS A CREDENTIAL. Anyone holding it can post into the channel
 * as the integration — the schema says so outright: "the token in it IS the
 * secret". So it is accepted inbound, never returned, and reads report only
 * whether one is configured plus a masked form. The blank-means-keep-existing
 * behaviour is deliberate for the same reason: the settings form should never
 * have to round-trip the URL through the browser to save an unrelated toggle.
 *
 * Email recipients are ordinary PII rather than credentials, so they are
 * readable — the owner set them and needs to see them.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  type DiscordIntegrationConfig,
  type EmailIntegrationConfig,
} from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { assertOwnedForm } from "@/lib/core/tenancy"

export type Result = { success: true } | { success: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DISCORD_WEBHOOK_RE = /^https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/

/** Split on commas/whitespace, lowercase, validate, dedupe. */
export function parseRecipients(input: string[] | string): string[] {
  const raw = Array.isArray(input) ? input.join(",") : input
  const seen = new Set<string>()
  for (const part of raw.split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase()
    if (e && EMAIL_RE.test(e)) seen.add(e)
  }
  return [...seen]
}

/**
 * Show enough of a Discord webhook to recognise it, not enough to use it.
 * Mirrors `maskWebhookUrl` in src/lib/data/integrations.ts.
 */
export function maskDiscordUrl(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\/([\w-]+)$/)
  if (!m) return "Webhook connected"
  return `…/webhooks/${m[1]}/${m[2].slice(0, 4)}••••`
}

function refresh(ctx: AuthContext, formId: string) {
  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
}

/** The single integration row of a given type for a form, if any. */
async function existingRow(ctx: AuthContext, formId: string, type: "email" | "discord") {
  const [row] = await db
    .select({ id: formIntegrations.id, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, type),
      ),
    )
    .limit(1)
  return row ?? null
}

// ── Email ──────────────────────────────────────────────────────────────────

export type EmailView = { configured: boolean; enabled: boolean; recipients: string[]; includeAnswers: boolean }

export async function getEmailNotification(
  ctx: AuthContext,
  formId: string,
): Promise<EmailView> {
  const [row] = await db
    .select({ enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "email"),
      ),
    )
    .limit(1)

  if (!row) return { configured: false, enabled: false, recipients: [], includeAnswers: false }
  const cfg = row.config as EmailIntegrationConfig
  return {
    configured: true,
    enabled: row.enabled,
    recipients: cfg.recipients ?? [],
    includeAnswers: Boolean(cfg.includeAnswers),
  }
}

export async function saveEmailNotification(
  ctx: AuthContext,
  formId: string,
  input: { recipients: string[] | string; includeAnswers: boolean; enabled: boolean },
): Promise<Result> {
  const owned = await assertOwnedForm(ctx, formId)
  if (!owned.ok) return { success: false, error: owned.error }

  const recipients = parseRecipients(input.recipients)
  if (recipients.length === 0) {
    return { success: false, error: "Add at least one valid email address." }
  }

  const config: EmailIntegrationConfig = { recipients, includeAnswers: input.includeAnswers }
  const existing = await existingRow(ctx, owned.row.id, "email")

  if (existing) {
    await db
      .update(formIntegrations)
      .set({ enabled: input.enabled, config })
      .where(eq(formIntegrations.id, existing.id))
  } else {
    await db.insert(formIntegrations).values({
      formId: owned.row.id,
      workspaceId: ctx.workspaceId,
      type: "email",
      enabled: input.enabled,
      config,
    })
  }

  refresh(ctx, owned.row.id)
  return { success: true }
}

export async function removeEmailNotification(ctx: AuthContext, formId: string): Promise<Result> {
  const owned = await assertOwnedForm(ctx, formId)
  if (!owned.ok) return { success: false, error: owned.error }

  await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, owned.row.id),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "email"),
      ),
    )

  refresh(ctx, owned.row.id)
  return { success: true }
}

// ── Discord ────────────────────────────────────────────────────────────────

export type DiscordView = {
  configured: boolean
  enabled: boolean
  /** Recognisable, unusable. The raw URL is never returned. */
  maskedUrl: string | null
  includeAnswers: boolean
}

export async function getDiscordWebhook(ctx: AuthContext, formId: string): Promise<DiscordView> {
  const [row] = await db
    .select({ enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "discord"),
      ),
    )
    .limit(1)

  if (!row) return { configured: false, enabled: false, maskedUrl: null, includeAnswers: false }
  const cfg = row.config as DiscordIntegrationConfig
  return {
    configured: true,
    enabled: row.enabled,
    maskedUrl: cfg.webhookUrl ? maskDiscordUrl(cfg.webhookUrl) : null,
    includeAnswers: Boolean(cfg.includeAnswers),
  }
}

export async function saveDiscordWebhook(
  ctx: AuthContext,
  formId: string,
  input: { webhookUrl: string; includeAnswers: boolean; enabled: boolean },
): Promise<Result> {
  const owned = await assertOwnedForm(ctx, formId)
  if (!owned.ok) return { success: false, error: owned.error }

  const existing = await existingRow(ctx, owned.row.id, "discord")
  const pasted = input.webhookUrl.trim()
  const storedUrl = (existing?.config as DiscordIntegrationConfig | undefined)?.webhookUrl

  // Blank means "keep what is stored" — the URL is a credential, so the caller
  // must be able to change an unrelated toggle without holding it.
  const webhookUrl = pasted || storedUrl
  if (!webhookUrl) return { success: false, error: "Paste a valid Discord webhook URL." }
  if (pasted && !DISCORD_WEBHOOK_RE.test(pasted)) {
    return { success: false, error: "That doesn't look like a Discord webhook URL." }
  }

  const config: DiscordIntegrationConfig = { webhookUrl, includeAnswers: input.includeAnswers }

  if (existing) {
    await db
      .update(formIntegrations)
      .set({ enabled: input.enabled, config })
      .where(eq(formIntegrations.id, existing.id))
  } else {
    await db.insert(formIntegrations).values({
      formId: owned.row.id,
      workspaceId: ctx.workspaceId,
      type: "discord",
      enabled: input.enabled,
      config,
    })
  }

  refresh(ctx, owned.row.id)
  return { success: true }
}

export async function removeDiscordWebhook(ctx: AuthContext, formId: string): Promise<Result> {
  const owned = await assertOwnedForm(ctx, formId)
  if (!owned.ok) return { success: false, error: owned.error }

  await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, owned.row.id),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "discord"),
      ),
    )

  refresh(ctx, owned.row.id)
  return { success: true }
}
