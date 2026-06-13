"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { forms, formIntegrations, type WebhookIntegrationConfig } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { postWebhook, type SubmissionPayload } from "@/lib/integrations/webhook"

type Result = { success: true } | { success: false; error: string }

function normalizeUrl(input: string): string | null {
  const url = input.trim()
  try {
    const u = new URL(url)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return u.toString()
  } catch {
    return null
  }
}

/** Add a webhook endpoint to a form. */
export async function addWebhook(
  formId: string,
  input: { url: string; secret?: string },
): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const url = normalizeUrl(input.url)
  if (!url) return { success: false, error: "Enter a valid http(s) URL." }

  const config: WebhookIntegrationConfig = { url }
  const secret = input.secret?.trim()
  if (secret) config.secret = secret

  await db.insert(formIntegrations).values({
    formId,
    workspaceId: workspace.id,
    type: "webhook",
    enabled: true,
    config,
  })

  revalidatePath(`/forms/${formId}/integrations`)
  return { success: true }
}

/** Enable/disable a single webhook. */
export async function toggleWebhook(integrationId: string, enabled: boolean): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .update(formIntegrations)
    .set({ enabled })
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .returning({ formId: formIntegrations.formId })
  if (!row) return { success: false, error: "Webhook not found" }

  revalidatePath(`/forms/${row.formId}/integrations`)
  return { success: true }
}

/** Remove a webhook endpoint. */
export async function removeWebhook(integrationId: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .returning({ formId: formIntegrations.formId })
  if (!row) return { success: false, error: "Webhook not found" }

  revalidatePath(`/forms/${row.formId}/integrations`)
  return { success: true }
}

/** Send a sample payload to a webhook so the user can verify their endpoint. */
export async function sendTestWebhook(
  integrationId: string,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .select({ config: formIntegrations.config, formId: formIntegrations.formId })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.id, integrationId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .limit(1)
  if (!row) return { success: false, error: "Webhook not found" }

  const [form] = await db
    .select({ title: forms.title, publicId: forms.publicId })
    .from(forms)
    .where(eq(forms.id, row.formId))
    .limit(1)

  const cfg = row.config as WebhookIntegrationConfig
  const sample: SubmissionPayload = {
    event: "submission.created",
    form: { id: row.formId, title: form?.title ?? "Test form", publicId: form?.publicId ?? "test" },
    submission: { id: "test_submission", submittedAt: new Date().toISOString() },
    answers: [{ fieldId: "test_field", question: "Sample question", value: "Sample answer" }],
  }

  const res = await postWebhook(cfg.url, JSON.stringify({ ...sample, test: true }), cfg.secret)
  return { success: res.ok, status: res.status, error: res.error }
}
