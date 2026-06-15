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

export type WorkspaceEmailForm = { id: string; title: string; status: "on" | "paused" }
export type WorkspaceWebhookForm = { id: string; title: string; total: number; active: number }

export type WorkspaceIntegrations = {
  configured: boolean
  connection: { accountEmail: string } | null
  forms: {
    id: string
    title: string
    status: FormSyncStatus
    spreadsheetUrl: string | null
  }[]
  email: { configured: boolean; forms: WorkspaceEmailForm[] }
  webhook: { forms: WorkspaceWebhookForm[] }
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

  // Every integration row for the workspace, split by type. Sheets is one row
  // per form; webhooks are many; email is one. Group them up for the cards.
  const integrationRows = await db
    .select({
      formId: formIntegrations.formId,
      type: formIntegrations.type,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(eq(formIntegrations.workspaceId, workspace.id))

  const byForm = new Map(
    integrationRows.filter((r) => r.type === "google_sheets").map((r) => [r.formId, r]),
  )
  const emailByForm = new Map(
    integrationRows.filter((r) => r.type === "email").map((r) => [r.formId, r]),
  )
  const webhookByForm = new Map<string, { total: number; active: number }>()
  for (const r of integrationRows) {
    if (r.type !== "webhook") continue
    const agg = webhookByForm.get(r.formId) ?? { total: 0, active: 0 }
    agg.total += 1
    if (r.enabled) agg.active += 1
    webhookByForm.set(r.formId, agg)
  }

  const title = (t: string) => t || "Untitled form"

  return {
    configured: isGoogleConfigured(),
    connection: conn ? { accountEmail: conn.accountEmail } : null,
    forms: formRows.map((f) => {
      const row = byForm.get(f.id)
      const cfg = row?.config as GoogleSheetsIntegrationConfig | undefined
      return {
        id: f.id,
        title: title(f.title),
        status: statusOf(connected, row),
        spreadsheetUrl: cfg?.spreadsheetUrl ?? null,
      }
    }),
    email: {
      configured: isEmailConfigured(),
      forms: formRows
        .filter((f) => emailByForm.has(f.id))
        .map((f) => ({
          id: f.id,
          title: title(f.title),
          status: emailByForm.get(f.id)!.enabled ? ("on" as const) : ("paused" as const),
        })),
    },
    webhook: {
      forms: formRows
        .filter((f) => (webhookByForm.get(f.id)?.total ?? 0) > 0)
        .map((f) => {
          const w = webhookByForm.get(f.id)!
          return { id: f.id, title: title(f.title), total: w.total, active: w.active }
        }),
    },
  }
}
