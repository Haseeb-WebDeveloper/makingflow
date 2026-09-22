import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  users,
  workspaceConnections,
  workspaceMembers,
  type GoogleSheetsIntegrationConfig,
  type NotionIntegrationConfig,
  type SheetShareError,
  type SheetSharingSetting,
} from "@/lib/db/schema"
import { isGoogleConfigured } from "@/lib/integrations/google"
import { isOrphanedSheetConfig } from "@/lib/integrations/sheets-provision"
import { resolveSharing } from "@/lib/integrations/sheets-sharing"
import { isEmailConfigured } from "@/lib/email/provider"
import { isNotionConfigured } from "@/lib/integrations/notion"

/**
 * Sync state of one form under the global model:
 * - `inactive` — the workspace hasn't connected Google.
 * - `pending`  — connected; will create its sheet on the next response.
 * - `syncing`  — connected and actively delivering to a spreadsheet.
 * - `paused`   — explicitly turned off for this form.
 * - `orphaned` — connected, but this form's destination was created under a
 *   DIFFERENT account than the one connected now, so it is unreachable. Says so
 *   instead of reporting "syncing" for a sheet no response can land in; resuming
 *   (or the next response) provisions a replacement in the current account.
 */
export type FormSyncStatus = "inactive" | "pending" | "syncing" | "paused" | "orphaned"

function statusOf(
  connection: { id: string } | undefined,
  row: { enabled: boolean; config: unknown } | undefined,
): FormSyncStatus {
  if (!connection) return "inactive"
  if (!row) return "pending"
  if (isOrphanedSheetConfig(row.config as { connectionId?: string } | undefined, connection.id)) {
    return "orphaned"
  }
  return row.enabled ? "syncing" : "paused"
}

/**
 * One spreadsheet's access, as the UI needs to render a button for it.
 *
 * `source` is what lets the button say "following the workspace" instead of
 * repeating a setting the person did not choose here — the difference between
 * inheriting and having decided is the whole point of the per-form control.
 */
/** One member, the role the setting gives them, and what became of it. */
export type AccessMemberState = {
  email: string
  /** What the setting says they should have — what the dialog's select shows. */
  role: "reader" | "writer" | "none"
  state: "shared" | "blocked" | "failed" | "pending"
  reason: SheetShareError | null
}

export type FormAccess = {
  source: "workspace" | "form"
  /** The general-access line: every member gets this, or nobody when null. */
  general: "reader" | "writer" | null
  /** Named people whose own role beats the general one ("none" shuts them out). */
  people: { email: string; role: "reader" | "writer" | "none" }[]
  /** People who can open it, and people we could not give access to. */
  granted: number
  blocked: number
}

/** Access of one sheets row, resolved against the workspace setting. */
function accessOf(
  config: GoogleSheetsIntegrationConfig | undefined,
  workspace: SheetSharingSetting | null,
): FormAccess {
  const override = config?.shareOverride
  const effective = resolveSharing(workspace ?? undefined, override)
  const shares = config?.shares ?? []
  return {
    source: override === undefined ? "workspace" : "form",
    general: effective?.general ?? null,
    people: effective?.people ?? [],
    granted: shares.filter((sh) => sh.permissionId).length,
    blocked: shares.filter((sh) => !sh.permissionId && sh.error).length,
  }
}

/**
 * Every member's standing on one spreadsheet: the role the setting gives them,
 * and what actually became of it.
 *
 * Everyone is listed whether or not they currently have access — this is the list
 * the share dialog is built from, so leaving people out would make them
 * unreachable.
 */
function memberStates(
  config: GoogleSheetsIntegrationConfig | undefined,
  access: FormAccess,
  memberEmails: string[],
  ownerEmail: string | undefined,
): AccessMemberState[] {
  const byEmail = new Map((config?.shares ?? []).map((sh) => [sh.email.toLowerCase(), sh]))
  const named = new Map(access.people.map((p) => [p.email.toLowerCase(), p.role]))
  const out: AccessMemberState[] = []

  for (const email of memberEmails) {
    const k = email.toLowerCase()
    if (k === ownerEmail) continue
    const role = named.get(k) ?? access.general ?? "none"
    const share = byEmail.get(k)
    const state: AccessMemberState["state"] = share?.permissionId
      ? "shared"
      : share?.error === "domain_policy" || share?.error === "not_a_google_account"
        ? "blocked"
        : share?.error
          ? "failed"
          : "pending"
    out.push({ email, role, state, reason: share?.error ?? null })
  }
  return out
}

/** The workspace's member addresses, in a stable order. */
async function workspaceMemberEmails(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(users.email)
  return rows.map((r) => r.email)
}

// ── Per-form Integrations tab ──────────────────────────────────────────────

export type GoogleSheetsState = {
  configured: boolean
  connection: { accountEmail: string } | null
  status: FormSyncStatus
  spreadsheetUrl: string | null
  /** Who can open THIS form's spreadsheet, and whether that was chosen here. */
  access: FormAccess
  /** Everyone who could be given access, with where each of them stands. */
  members: AccessMemberState[]
}

export async function getGoogleSheetsState(formId: string, workspaceId: string): Promise<GoogleSheetsState | null> {

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId)))
    .limit(1)
  if (!form) return null

  const [conn] = await db
    .select({
      id: workspaceConnections.id,
      accountEmail: workspaceConnections.accountEmail,
      metadata: workspaceConnections.metadata,
    })
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
  const access = accessOf(cfg, conn?.metadata?.google?.share ?? null)
  return {
    configured: isGoogleConfigured(),
    connection: conn ? { accountEmail: conn.accountEmail } : null,
    status: statusOf(conn, row),
    spreadsheetUrl: cfg?.spreadsheetUrl ?? null,
    access,
    members: conn
      ? memberStates(
          cfg,
          access,
          await workspaceMemberEmails(workspaceId),
          conn.accountEmail.toLowerCase(),
        )
      : [],
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
    .select({ id: workspaceConnections.id, accountEmail: workspaceConnections.accountEmail })
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
    status: statusOf(conn, row),
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
  /**
   * Every form in the workspace, most recently edited first.
   *
   * The per-type `forms` lists below hold only the forms where that integration
   * is already set up, which is what the cards' counts are built on. Webhooks,
   * email and Discord are configured per form, so their panels need the full
   * list too — otherwise the empty state can tell you to go open a form without
   * being able to offer you one, which is where people conclude the feature
   * does not work.
   */
  allForms: { id: string; title: string }[]
  forms: {
    id: string
    title: string
    status: FormSyncStatus
    spreadsheetUrl: string | null
    /** Who can open this form's spreadsheet — per form, so the row can say. */
    access: FormAccess
  }[]
  email: { configured: boolean; forms: WorkspaceEmailForm[] }
  webhook: { forms: WorkspaceWebhookForm[] }
  discord: { forms: WorkspaceDiscordForm[] }
  notion: {
    configured: boolean
    connection: { workspaceName: string } | null
    forms: WorkspaceNotionForm[]
  }
  /**
   * Whether the workspace's members can open the response spreadsheets, and how
   * each of them is actually getting on.
   *
   * Rolled up ACROSS forms on purpose: one blocked member is one row to act on,
   * not one row per spreadsheet. Whether the viewer may change any of this is not
   * here — the page passes that down separately, as it already does for the MCP
   * card's owner check.
   */
  sharing: {
    setting: SheetSharingSetting | null
    /** Forms that answer the access question themselves — the bulk control warns. */
    customisedForms: number
    members: {
      email: string
      state: "shared" | "blocked" | "failed" | "pending"
      reason: SheetShareError | null
      /** How many of the workspace's spreadsheets this person can open. */
      sheets: number
    }[]
  }
}

export async function getWorkspaceIntegrations(
  workspaceId: string,
): Promise<WorkspaceIntegrations | null> {

  const [conn, notionConn] = await Promise.all([
    db
      .select({
        id: workspaceConnections.id,
        accountEmail: workspaceConnections.accountEmail,
        metadata: workspaceConnections.metadata,
      })
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
      .select({ id: workspaceConnections.id, accountEmail: workspaceConnections.accountEmail })
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

  // ── Sharing, rolled up per person ──
  //
  // A member with one failure and four successes reads as "blocked": the failure
  // is the thing somebody has to do something about, and averaging it away into
  // "shared" is how a missing teammate goes unnoticed.
  const sharingSetting = conn?.metadata?.google?.share ?? null
  const ownerEmail = conn?.accountEmail?.toLowerCase()
  const memberRollup = new Map<
    string,
    WorkspaceIntegrations["sharing"]["members"][number]
  >()
  if (sharingSetting) {
    const memberRows = await db
      .select({ email: users.email })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(users.email)
    const named = new Map(
      (sharingSetting.people ?? []).map((p) => [p.email.toLowerCase(), p.role]),
    )
    for (const { email } of memberRows) {
      const k = email.toLowerCase()
      if (k === ownerEmail) continue
      // Anyone the setting gives no role to is not waiting on anything.
      const role = named.get(k) ?? sharingSetting.general
      if (!role || role === "none") continue
      memberRollup.set(k, { email, state: "pending", reason: null, sheets: 0 })
    }
    for (const row of integrationRows) {
      if (row.type !== "google_sheets") continue
      for (const share of (row.config as GoogleSheetsIntegrationConfig).shares ?? []) {
        const entry = memberRollup.get(share.email.toLowerCase())
        if (!entry) continue
        if (share.permissionId) {
          entry.sheets += 1
          if (entry.state === "pending") entry.state = "shared"
        } else if (share.error) {
          entry.state =
            share.error === "domain_policy" || share.error === "not_a_google_account"
              ? "blocked"
              : "failed"
          entry.reason = share.error
        }
      }
    }
  }

  return {
    configured: isGoogleConfigured(),
    connection: conn ? { accountEmail: conn.accountEmail } : null,
    sharing: {
      setting: sharingSetting,
      customisedForms: integrationRows.filter(
        (r) =>
          r.type === "google_sheets" &&
          (r.config as GoogleSheetsIntegrationConfig).shareOverride !== undefined,
      ).length,
      members: [...memberRollup.values()],
    },
    allForms: formRows.map((f) => ({ id: f.id, title: title(f.title) })),
    forms: formRows.map((f) => {
      const row = byForm.get(f.id)
      const cfg = row?.config as GoogleSheetsIntegrationConfig | undefined
      return {
        id: f.id,
        title: title(f.title),
        status: statusOf(conn, row),
        spreadsheetUrl: cfg?.spreadsheetUrl ?? null,
        access: accessOf(cfg, sharingSetting),
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
          status: statusOf(notionConn, row),
          databaseUrl: cfg?.databaseUrl ?? null,
        }
      }),
    },
  }
}
