"use server"

import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  workspaceConnections,
  type GoogleSheetsIntegrationConfig,
} from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { createFormSheet, refreshFormSheetHeader } from "@/lib/integrations/sheets-provision"

type Result = { success: true } | { success: false; error: string }

async function workspaceGoogleConnection(workspaceId: string) {
  const [conn] = await db
    .select()
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspaceId),
        eq(workspaceConnections.provider, "google"),
      ),
    )
    .limit(1)
  return conn ?? null
}

/**
 * Resume / create a form's Google Sheets sync. Under the global model every
 * form syncs automatically once the workspace connects, so this is only needed
 * to UN-pause a form, or to create its spreadsheet eagerly before its first
 * response. Reuses the existing spreadsheet (refreshing its header) when present.
 */
export async function enableFormSheet(formId: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [form] = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const conn = await workspaceGoogleConnection(workspace.id)
  if (!conn) return { success: false, error: "Connect a Google account first" }

  const [existing] = await db
    .select()
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)

  try {
    const prev = existing?.config as GoogleSheetsIntegrationConfig | undefined
    const config = prev?.spreadsheetId
      ? await refreshFormSheetHeader(conn, prev, formId)
      : await createFormSheet(conn, formId, form.title)

    if (existing) {
      await db
        .update(formIntegrations)
        .set({ enabled: true, config })
        .where(eq(formIntegrations.id, existing.id))
    } else {
      await db.insert(formIntegrations).values({
        formId,
        workspaceId: workspace.id,
        type: "google_sheets",
        enabled: true,
        config,
      })
    }
  } catch (err) {
    console.error("[enableFormSheet] failed", err)
    return { success: false, error: "Couldn't set up the spreadsheet. Reconnect Google and try again." }
  }

  revalidatePath(`/forms/${formId}/integrations`)
  revalidatePath("/integrations")
  return { success: true }
}

/**
 * Pause Sheets sync for a single form (keeps the spreadsheet for later). Works
 * even before the form has synced once — we record a disabled placeholder row
 * so the form is excluded from the global auto-sync until resumed.
 */
export async function pauseFormSheet(formId: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [existing] = await db
    .select({ id: formIntegrations.id })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "google_sheets"),
      ),
    )
    .limit(1)

  if (existing) {
    await db.update(formIntegrations).set({ enabled: false }).where(eq(formIntegrations.id, existing.id))
  } else {
    // No sheet yet — verify the form is ours and the workspace is connected,
    // then store a disabled placeholder (spreadsheet is created on resume).
    const [form] = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
      .limit(1)
    const conn = await workspaceGoogleConnection(workspace.id)
    if (!form || !conn) return { success: false, error: "Nothing to pause" }
    await db.insert(formIntegrations).values({
      formId,
      workspaceId: workspace.id,
      type: "google_sheets",
      enabled: false,
      config: { connectionId: conn.id, spreadsheetId: "" },
    })
  }

  revalidatePath(`/forms/${formId}/integrations`)
  revalidatePath("/integrations")
  return { success: true }
}

/**
 * Disconnect the workspace's Google account: this is the global off-switch.
 * Deletes the grant and disables every form's Sheets sync (spreadsheets are
 * left intact in the user's Drive).
 */
export async function disconnectGoogle(returnFormId?: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  await db.transaction(async (tx) => {
    await tx
      .update(formIntegrations)
      .set({ enabled: false })
      .where(
        and(
          eq(formIntegrations.workspaceId, workspace.id),
          eq(formIntegrations.type, "google_sheets"),
        ),
      )
    await tx
      .delete(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, workspace.id),
          eq(workspaceConnections.provider, "google"),
        ),
      )
  })

  if (returnFormId) revalidatePath(`/forms/${returnFormId}/integrations`)
  revalidatePath("/integrations")
  return { success: true }
}
