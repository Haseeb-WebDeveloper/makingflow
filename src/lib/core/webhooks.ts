/**
 * Webhook endpoints on a form, transport-agnostic.
 *
 * TWO THINGS THAT ARE NOT OPTIONAL HERE.
 *
 * The signing secret is write-only. `WebhookIntegrationConfig.secret` is what
 * lets a receiver prove a delivery came from us; handing it back in a read
 * would let anyone who can call a tool forge our signature. Reads report
 * `hasSecret: boolean`, which is what `getFormWebhooks` already does.
 *
 * The destination URL goes through `checkOutboundUrl`. The old check accepted
 * any http(s) host, which was fine when the only way to set one was a human
 * typing their own endpoint into a browser. A model can be talked into pointing
 * it at internal infrastructure, and `sendTest` returns the HTTP status of
 * whatever it reached.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formIntegrations, type WebhookIntegrationConfig } from "@/lib/db/schema"
import { postWebhook, type SubmissionPayload } from "@/lib/integrations/webhook"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { assertOwnedForm } from "@/lib/core/tenancy"
import { checkOutboundUrl } from "@/lib/core/outbound-url"

export type Result = { success: true } | { success: false; error: string }
export type TestResult = { success: boolean; status?: number; error?: string }

/** A webhook as it is safe to show — never the secret, never a bare config. */
export type WebhookView = {
  id: string
  url: string
  enabled: boolean
  hasSecret: boolean
}

function refresh(ctx: AuthContext, formId: string) {
  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
}

/** Resolve one webhook the caller's workspace owns. */
async function ownedWebhook(ctx: AuthContext, integrationId: string) {
  const [row] = await db
    .select({
      id: formIntegrations.id,
      formId: formIntegrations.formId,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listWebhooks(ctx: AuthContext, formId: string): Promise<WebhookView[]> {
  const rows = await db
    .select({
      id: formIntegrations.id,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )

  return rows.map((r) => {
    const cfg = r.config as WebhookIntegrationConfig
    return {
      id: r.id,
      url: cfg.url,
      enabled: r.enabled,
      // Presence, never the value.
      hasSecret: Boolean(cfg.secret),
    }
  })
}

export async function addWebhook(
  ctx: AuthContext,
  formId: string,
  input: { url: string; secret?: string },
): Promise<Result> {
  const owned = await assertOwnedForm(ctx, formId)
  if (!owned.ok) return { success: false, error: owned.error }

  const checked = checkOutboundUrl(input.url)
  if (!checked.ok) return { success: false, error: checked.error }

  const config: WebhookIntegrationConfig = { url: checked.url }
  const secret = input.secret?.trim()
  if (secret) config.secret = secret

  await db.insert(formIntegrations).values({
    formId: owned.row.id,
    workspaceId: ctx.workspaceId,
    type: "webhook",
    enabled: true,
    config,
  })

  refresh(ctx, owned.row.id)
  return { success: true }
}

export async function toggleWebhook(
  ctx: AuthContext,
  integrationId: string,
  enabled: boolean,
): Promise<Result> {
  const [row] = await db
    .update(formIntegrations)
    .set({ enabled })
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .returning({ formId: formIntegrations.formId })
  if (!row) return { success: false, error: "Webhook not found" }

  refresh(ctx, row.formId)
  return { success: true }
}

export async function removeWebhook(ctx: AuthContext, integrationId: string): Promise<Result> {
  const [row] = await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .returning({ formId: formIntegrations.formId })
  if (!row) return { success: false, error: "Webhook not found" }

  refresh(ctx, row.formId)
  return { success: true }
}

/** Send a sample payload so the owner can verify their endpoint receives it. */
export async function sendTestWebhook(
  ctx: AuthContext,
  integrationId: string,
): Promise<TestResult> {
  const row = await ownedWebhook(ctx, integrationId)
  if (!row) return { success: false, error: "Webhook not found" }

  const cfg = row.config as WebhookIntegrationConfig

  // Re-check at send time, not only at save time. A URL stored before this
  // guard existed, or one whose host now resolves somewhere it should not,
  // must not be reachable just because it is already in the table.
  const checked = checkOutboundUrl(cfg.url)
  if (!checked.ok) return { success: false, error: checked.error }

  const [form] = await db
    .select({ title: forms.title, publicId: forms.publicId })
    .from(forms)
    .where(eq(forms.id, row.formId))
    .limit(1)

  const sample: SubmissionPayload = {
    event: "submission.created",
    form: { id: row.formId, title: form?.title ?? "Test form", publicId: form?.publicId ?? "test" },
    submission: { id: "test_submission", submittedAt: new Date().toISOString() },
    answers: [{ fieldId: "test_field", question: "Sample question", value: "Sample answer" }],
  }

  const res = await postWebhook(checked.url, JSON.stringify({ ...sample, test: true }), cfg.secret)
  return { success: res.ok, status: res.status, error: res.error }
}
