import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  workspaceConnections,
  type GoogleSheetsIntegrationConfig,
} from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { isGoogleConfigured } from "@/lib/integrations/google"
import { isEmailConfigured } from "@/lib/email/provider"

/**
 * Sync state of one form under the global model:
 * - `inactive` — the workspace hasn't connected Google.
 * - `pending`  — connected; will create its sheet on the next response.
 * - `syncing`  — connected and actively delivering to a spreadsheet.
 * - `paused`   — explicitly turned off for this form.
 */
export type FormSyncStatus = "inactive" | "pending" | "syncing" | "paused"

function statusOf(
  connected: boolean,
  row: { enabled: boolean } | undefined,
): FormSyncStatus {
  if (!connected) return "inactive"
  if (!row) return "pending"
  return row.enabled ? "syncing" : "paused"
}

// ── Per-form Integrations tab ──────────────────────────────────────────────

export type GoogleSheetsState = {
  configured: boolean
  connection: { accountEmail: string } | null
  status: FormSyncStatus
  spreadsheetUrl: string | null
}

export async function getGoogleSheetsState(formId: string): Promise<GoogleSheetsState | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!form) return null

  const [conn] = await db
    .select({ accountEmail: workspaceConnections.accountEmail })
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspace.id),
        eq(workspaceConnections.provider, "google"),
      ),
    )
    .limit(1)

  const [row] = await db
    .select({ enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)

  const cfg = row?.config as GoogleSheetsIntegrationConfig | undefined
  return {
    configured: isGoogleConfigured(),
    connection: conn ? { accountEmail: conn.accountEmail } : null,
    status: statusOf(Boolean(conn), row),
    spreadsheetUrl: cfg?.spreadsheetUrl ?? null,
  }
}

// ── Workspace Integrations control center (/integrations) ───────────────────

// ── Per-form webhooks ───────────────────────────────────────────────────────

export type FormWebhook = {
  id: string
  url: string
  enabled: boolean
  hasSecret: boolean
}

/** Webhook endpoints configured on a form (secret value never leaves the server). */
export async function getFormWebhooks(formId: string): Promise<FormWebhook[]> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return []

  const rows = await db
    .select({ id: formIntegrations.id, enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "webhook"),
      ),
    )
    .orderBy(formIntegrations.createdAt)

  return rows.map((r) => {
    const cfg = r.config as { url?: string; secret?: string } | null
    return {
      id: r.id,
      url: cfg?.url ?? "",
      enabled: r.enabled,
      hasSecret: Boolean(cfg?.secret),
    }
  })
}

// ── Per-form email notifications ────────────────────────────────────────────

export type FormEmailState = {
  configured: boolean
  notification: { id: string; recipients: string[]; includeAnswers: boolean; enabled: boolean } | null
}

/** The form's single email-notification config (recipients + options). */
export async function getFormEmail(formId: string): Promise<FormEmailState> {
  const configured = isEmailConfigured()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { configured, notification: null }

  const [row] = await db
    .select({ id: formIntegrations.id, enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "email"),
      ),
    )
    .limit(1)

  const cfg = row?.config as { recipients?: string[]; includeAnswers?: boolean } | null
  return {
    configured,
    notification: row
      ? {
          id: row.id,
          recipients: cfg?.recipients ?? [],
          includeAnswers: cfg?.includeAnswers ?? false,
          enabled: row.enabled,
        }
      : null,
  }
}

export type WorkspaceIntegrations = {
  configured: boolean
  connection: { accountEmail: string } | null
  forms: {
    id: string
    title: string
    status: FormSyncStatus
    spreadsheetUrl: string | null
  }[]
}

export async function getWorkspaceIntegrations(): Promise<WorkspaceIntegrations | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  const [conn] = await db
    .select({ accountEmail: workspaceConnections.accountEmail })
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspace.id),
        eq(workspaceConnections.provider, "google"),
      ),
    )
    .limit(1)
  const connected = Boolean(conn)

  const formRows = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .orderBy(desc(forms.updatedAt))

  const integrationRows = await db
    .select({
      formId: formIntegrations.formId,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.workspaceId, workspace.id),
        eq(formIntegrations.type, "google_sheets"),
      ),
    )
  const byForm = new Map(integrationRows.map((r) => [r.formId, r]))

  return {
    configured: isGoogleConfigured(),
    connection: conn ? { accountEmail: conn.accountEmail } : null,
    forms: formRows.map((f) => {
      const row = byForm.get(f.id)
      const cfg = row?.config as GoogleSheetsIntegrationConfig | undefined
      return {
        id: f.id,
        title: f.title || "Untitled form",
        status: statusOf(connected, row),
        spreadsheetUrl: cfg?.spreadsheetUrl ?? null,
      }
    }),
  }
}
