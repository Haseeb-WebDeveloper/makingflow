"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { forms, formIntegrations, type DiscordIntegrationConfig } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"

type Result = { success: true } | { success: false; error: string }

// Discord incoming-webhook URL, e.g.
// https://discord.com/api/webhooks/123456789/aBcD-token_value
const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/

/**
 * Create or update the form's single Discord webhook. Upserts one `discord`
 * integration row per form. The webhook URL is the secret, so when the caller
 * leaves it blank we keep the stored one (and only update the toggles).
 */
export async function saveDiscordWebhook(
  formId: string,
  input: { webhookUrl: string; includeAnswers: boolean; enabled: boolean },
): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const [existing] = await db
    .select({ id: formIntegrations.id, config: formIntegrations.config })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "discord")))
    .limit(1)

  const pasted = input.webhookUrl.trim()
  const storedUrl = (existing?.config as DiscordIntegrationConfig | undefined)?.webhookUrl

  // Use the freshly pasted URL if given; otherwise keep the stored one.
  const webhookUrl = pasted || storedUrl
  if (!webhookUrl) {
    return { success: false, error: "Paste a valid Discord webhook URL." }
  }
  if (pasted && !DISCORD_WEBHOOK_RE.test(pasted)) {
    return { success: false, error: "That doesn't look like a Discord webhook URL." }
  }

  const config: DiscordIntegrationConfig = {
    webhookUrl,
    includeAnswers: input.includeAnswers,
  }

  if (existing) {
    await db
      .update(formIntegrations)
      .set({ enabled: input.enabled, config })
      .where(eq(formIntegrations.id, existing.id))
  } else {
    await db.insert(formIntegrations).values({
      formId,
      workspaceId: workspace.id,
      type: "discord",
      enabled: input.enabled,
      config,
    })
  }

  revalidatePath(`/forms/${formId}/integrations`)
  revalidatePath("/integrations")
  return { success: true }
}

/** Remove the form's Discord webhook entirely. */
export async function removeDiscordWebhook(formId: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  await db
    .delete(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "discord"),
      ),
    )

  revalidatePath(`/forms/${formId}/integrations`)
  revalidatePath("/integrations")
  return { success: true }
}
