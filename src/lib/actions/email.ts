"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { forms, formIntegrations, type EmailIntegrationConfig } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"

type Result = { success: true } | { success: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Split on commas/whitespace, lowercase, validate, dedupe. */
function parseRecipients(input: string[] | string): string[] {
  const raw = Array.isArray(input) ? input.join(",") : input
  const seen = new Set<string>()
  for (const part of raw.split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase()
    if (e && EMAIL_RE.test(e)) seen.add(e)
  }
  return [...seen]
}

/**
 * Create or update the form's single email-notification config. Upserts one
 * `email` integration row per form (multiple recipients live in its config).
 */
export async function saveEmailNotification(
  formId: string,
  input: { recipients: string[] | string; includeAnswers: boolean; enabled: boolean },
): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const recipients = parseRecipients(input.recipients)
  if (recipients.length === 0) {
    return { success: false, error: "Add at least one valid email address." }
  }

  const config: EmailIntegrationConfig = { recipients, includeAnswers: input.includeAnswers }

  const [existing] = await db
    .select({ id: formIntegrations.id })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "email")))
    .limit(1)

  if (existing) {
    await db
      .update(formIntegrations)
      .set({ enabled: input.enabled, config })
      .where(eq(formIntegrations.id, existing.id))
  } else {
    await db.insert(formIntegrations).values({
      formId,
      workspaceId: workspace.id,
      type: "email",
      enabled: input.enabled,
      config,
    })
  }

  revalidatePath(`/forms/${formId}/integrations`)
  return { success: true }
}

/** Remove the form's email notification entirely. */
export async function removeEmailNotification(formId: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "email"),
      ),
    )

  revalidatePath(`/forms/${formId}/integrations`)
  return { success: true }
}
