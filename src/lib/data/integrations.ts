import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  workspaceConnections,
  type GoogleSheetsIntegrationConfig,
  type NotionIntegrationConfig,
} from "@/lib/db/schema"
import { isGoogleConfigured } from "@/lib/integrations/google"
import { isEmailConfigured } from "@/lib/email/provider"
import { isNotionConfigured } from "@/lib/integrations/notion"

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

export async function getGoogleSheetsState(formId: string, workspaceId: string): Promise<GoogleSheetsState | null> {

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId)))
    .limit(1)
  if (!form) return null

  const [conn] = await db
    .select({ accountEmail: workspaceConnections.accountEmail })
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspaceId),
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

// ── Per-form Notion ─────────────────────────────────────────────────────────

export type NotionState = {
  configured: boolean
  connection: { workspaceName: string } | null
  status: FormSyncStatus
  databaseUrl: string | null
}

export async function getNotionState(formId: string, workspaceId: string): Promise<NotionState> {
  const configured = isNotionConfigured()

  const [conn] = await db
    .select({ accountEmail: workspaceConnections.accountEmail })
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspaceId),
        eq(workspaceConnections.provider, "notion"),
      ),
    )
    .limit(1)

  const [row] = await db
    .select({ enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "notion")))
    .limit(1)

  const cfg = row?.config as NotionIntegrationConfig | undefined
  return {
    configured,
    connection: conn ? { workspaceName: conn.accountEmail } : null,
    status: statusOf(Boolean(conn), row),
    databaseUrl: cfg?.databaseUrl ?? null,
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
export async function getFormWebhooks(formId: string, workspaceId: string): Promise<FormWebhook[]> {

  const rows = await db
    .select({ id: formIntegrations.id, enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspaceId),
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
export async function getFormEmail(formId: string, workspaceId: string): Promise<FormEmailState> {
  const configured = isEmailConfigured()

  const [row] = await db
    .select({ id: formIntegrations.id, enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspaceId),
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

// ── Per-form Discord ────────────────────────────────────────────────────────

export type FormDiscordState = {
  // The webhook URL is its own secret, so it never leaves the server — the card
  // only learns whether one is set (and a masked hint), not the URL itself.
  notification: { id: string; hasWebhook: boolean; maskedUrl: string | null; includeAnswers: boolean; enabled: boolean } | null
}

/** Mask a Discord webhook URL down to a non-sensitive hint (…/123456/abcd••••). */
function maskWebhookUrl(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\/([\w-]+)$/)
  if (!m) return "Webhook connected"
  return `…/webhooks/${m[1]}/${m[2].slice(0, 4)}••••`
}

/** The form's single Discord webhook config — without exposing the URL/token. */
export async function getFormDiscord(formId: string, workspaceId: string): Promise<FormDiscordState> {

  const [row] = await db
    .select({ id: formIntegrations.id, enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, workspaceId),
        eq(formIntegrations.type, "discord"),
      ),
    )
    .limit(1)

  const cfg = row?.config as { webhookUrl?: string; includeAnswers?: boolean } | null
  return {
    notification: row
      ? {
          id: row.id,
          hasWebhook: Boolean(cfg?.webhookUrl),
          maskedUrl: cfg?.webhookUrl ? maskWebhookUrl(cfg.webhookUrl) : null,
          includeAnswers: cfg?.includeAnswers ?? false,
          enabled: row.enabled,
        }
      : null,
  }
}

export type WorkspaceEmailForm = { id: string; title: string; status: "on" | "paused" }
export type WorkspaceWebhookForm = { id: string; title: string; total: number; active: number }
export type WorkspaceDiscordForm = { id: string; title: string; status: "on" | "paused" }
export type WorkspaceNotionForm = {
  id: string
  title: string
  status: FormSyncStatus
  databaseUrl: string | null
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
  email: { configured: boolean; forms: WorkspaceEmailForm[] }
  webhook: { forms: WorkspaceWebhookForm[] }
  discord: { forms: WorkspaceDiscordForm[] }
  notion: {
    configured: boolean
    connection: { workspaceName: string } | null
    forms: WorkspaceNotionForm[]
  }
}

export async function getWorkspaceIntegrations(
  workspaceId: string,
): Promise<WorkspaceIntegrations | null> {

  const [conn, notionConn] = await Promise.all([
    db
      .select({ accountEmail: workspaceConnections.accountEmail })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, workspaceId),
          eq(workspaceConnections.provider, "google"),
        ),
      )
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ accountEmail: workspaceConnections.accountEmail })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, workspaceId),
          eq(workspaceConnections.provider, "notion"),
        ),
      )
      .limit(1)
      .then((r) => r[0]),
  ])
  const connected = Boolean(conn)
  const notionConnected = Boolean(notionConn)

  const formRows = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
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
    .where(eq(formIntegrations.workspaceId, workspaceId))

  const byForm = new Map(
    integrationRows.filter((r) => r.type === "google_sheets").map((r) => [r.formId, r]),
  )
  const emailByForm = new Map(
    integrationRows.filter((r) => r.type === "email").map((r) => [r.formId, r]),
  )
  const discordByForm = new Map(
    integrationRows.filter((r) => r.type === "discord").map((r) => [r.formId, r]),
  )
  const notionByForm = new Map(
    integrationRows.filter((r) => r.type === "notion").map((r) => [r.formId, r]),
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
    discord: {
      forms: formRows
        .filter((f) => discordByForm.has(f.id))
        .map((f) => ({
          id: f.id,
          title: title(f.title),
          status: discordByForm.get(f.id)!.enabled ? ("on" as const) : ("paused" as const),
        })),
    },
    notion: {
      configured: isNotionConfigured(),
      connection: notionConn ? { workspaceName: notionConn.accountEmail } : null,
      forms: formRows.map((f) => {
        const row = notionByForm.get(f.id)
        const cfg = row?.config as NotionIntegrationConfig | undefined
        return {
          id: f.id,
          title: title(f.title),
          status: statusOf(notionConnected, row),
          databaseUrl: cfg?.databaseUrl ?? null,
        }
      }),
    },
  }
}
