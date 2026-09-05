import { and, eq, isNull } from "drizzle-orm"
import { after } from "next/server"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  workspaceConnections,
  type GoogleSheetsIntegrationConfig,
  type NotionIntegrationConfig,
} from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { createFormSheet, refreshFormSheetHeader } from "@/lib/integrations/sheets-provision"
import { backfillFormSheet } from "@/lib/integrations/sync"
import { backfillFormNotionDatabase } from "@/lib/integrations/notion-sync"
import {
  createFormDatabase,
  NotionNoParentPageError,
  reconcileFormDatabase,
  TITLE_PROP,
} from "@/lib/integrations/notion-provision"

type Result = { success: true } | { success: false; error: string }

/**
 * The workspace's OAuth grant for a provider.
 *
 * Deliberately unprojected: the provisioning helpers
 * (`createFormSheet`, `refreshFormSheetHeader`, `backfillFormSheet`,
 * `createFormDatabase`, …) take a whole `WorkspaceConnection` because they need
 * the access and refresh tokens to call Google and Notion.
 *
 * THE RULE THAT KEEPS THAT SAFE: this value never leaves the module. Every
 * exported function here returns a `Result`, never a connection. Anything that
 * needs to *describe* the connection to a caller — the MCP surface especially —
 * uses `describeConnections` below, which projects. If you find yourself
 * returning `conn` from an exported function, you are about to hand someone
 * else's Google refresh token to a language model.
 */
async function workspaceConnection(ctx: AuthContext, provider: "google" | "notion") {
  const [conn] = await db
    .select()
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, ctx.workspaceId),
        eq(workspaceConnections.provider, provider),
      ),
    )
    .limit(1)
  return conn ?? null
}

const workspaceGoogleConnection = (ctx: AuthContext) => workspaceConnection(ctx, "google")

/**
 * Resume / create a form's Google Sheets sync. Under the global model every
 * form syncs automatically once the workspace connects, so this is only needed
 * to UN-pause a form, or to create its spreadsheet eagerly before its first
 * response. Reuses the existing spreadsheet (refreshing its header) when present.
 */
export async function enableFormSheet(ctx: AuthContext, formId: string): Promise<Result> {

  const [form] = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const conn = await workspaceGoogleConnection(ctx)
  if (!conn) return { success: false, error: "Connect a Google account first" }

  const [existing] = await db
    .select()
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "google_sheets"),
      ),
    )
    .limit(1)

  let config: GoogleSheetsIntegrationConfig
  try {
    const prev = existing?.config as GoogleSheetsIntegrationConfig | undefined
    config = prev?.spreadsheetId
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
        workspaceId: ctx.workspaceId,
        type: "google_sheets",
        enabled: true,
        config,
      })
    }
  } catch (err) {
    console.error("[enableFormSheet] failed", err)
    return { success: false, error: "Couldn't set up the spreadsheet. Reconnect Google and try again." }
  }

  // Pull any responses that predate this sync into the sheet (idempotent — skips
  // rows already present). Deferred: the sheet is already set up, and a long
  // history is more rows than a server action's budget wants to sit through.
  after(async () => {
    await backfillFormSheet(conn, config, formId)
    invalidate(ctx, { paths: [`/forms/${formId}/integrations`] })
  })

  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
  return { success: true }
}

/**
 * Pause Sheets sync for a single form (keeps the spreadsheet for later). Works
 * even before the form has synced once — we record a disabled placeholder row
 * so the form is excluded from the global auto-sync until resumed.
 */
export async function pauseFormSheet(ctx: AuthContext, formId: string): Promise<Result> {

  const [existing] = await db
    .select({ id: formIntegrations.id })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
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
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId), isNull(forms.deletedAt)))
      .limit(1)
    const conn = await workspaceGoogleConnection(ctx)
    if (!form || !conn) return { success: false, error: "Nothing to pause" }
    await db.insert(formIntegrations).values({
      formId,
      workspaceId: ctx.workspaceId,
      type: "google_sheets",
      enabled: false,
      config: { connectionId: conn.id, spreadsheetId: "" },
    })
  }

  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
  return { success: true }
}

/**
 * Disconnect the workspace's Google account: this is the global off-switch.
 * Deletes the grant and disables every form's Sheets sync (spreadsheets are
 * left intact in the user's Drive).
 */
export async function disconnectGoogle(ctx: AuthContext, returnFormId?: string): Promise<Result> {

  await db.transaction(async (tx) => {
    await tx
      .update(formIntegrations)
      .set({ enabled: false })
      .where(
        and(
          eq(formIntegrations.workspaceId, ctx.workspaceId),
          eq(formIntegrations.type, "google_sheets"),
        ),
      )
    await tx
      .delete(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, ctx.workspaceId),
          eq(workspaceConnections.provider, "google"),
        ),
      )
  })

  invalidate(ctx, {
    paths: returnFormId
      ? [`/forms/${returnFormId}/integrations`, "/integrations"]
      : ["/integrations"],
  })
  return { success: true }
}

// ── Notion (mirror of the Google actions; global connect-once model) ─────────

/**
 * Resume / create a form's Notion sync. Like Sheets, every form syncs once the
 * workspace connects; this un-pauses a form or creates its database eagerly.
 * Reuses the existing database when present.
 */
export async function enableFormNotion(ctx: AuthContext, formId: string): Promise<Result> {

  const [form] = await db
    .select({ id: forms.id, title: forms.title })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  const conn = await workspaceConnection(ctx, "notion")
  if (!conn) return { success: false, error: "Connect a Notion account first" }

  const [existing] = await db
    .select()
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "notion"),
      ),
    )
    .limit(1)

  let config: NotionIntegrationConfig
  try {
    const prev = existing?.config as NotionIntegrationConfig | undefined
    // Reconcile before reusing: the form may have gained questions while this
    // was paused, and the backfill below writes only the properties the config
    // knows about. Pages are never revisited, so a stale config would leave
    // those answers permanently missing from the history it writes.
    // (The Sheets branch above gets this from refreshFormSheetHeader.)
    config = prev?.databaseId
      ? (await reconcileFormDatabase(conn, prev, formId)).config
      : await createFormDatabase(conn, formId, form.title)

    if (existing) {
      await db
        .update(formIntegrations)
        .set({ enabled: true, config })
        .where(eq(formIntegrations.id, existing.id))
    } else {
      await db.insert(formIntegrations).values({
        formId,
        workspaceId: ctx.workspaceId,
        type: "notion",
        enabled: true,
        config,
      })
    }
  } catch (err) {
    console.error("[enableFormNotion] failed", err)
    // "Share a page with the integration" is something only the user can do —
    // telling them to reconnect sends them round a loop that can't fix it.
    if (err instanceof NotionNoParentPageError) return { success: false, error: err.message }
    return { success: false, error: "Couldn't set up the Notion database. Reconnect Notion and try again." }
  }

  // Pull any responses that predate this sync into the database (idempotent —
  // skips pages already present). Deferred because Notion takes one request per
  // page, paced: a few hundred responses is minutes, not milliseconds.
  after(async () => {
    await backfillFormNotionDatabase(conn, config, formId)
    invalidate(ctx, { paths: [`/forms/${formId}/integrations`] })
  })

  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
  return { success: true }
}

/** Pause Notion sync for a single form (keeps the database for later). */
export async function pauseFormNotion(ctx: AuthContext, formId: string): Promise<Result> {

  const [existing] = await db
    .select({ id: formIntegrations.id })
    .from(formIntegrations)
    .where(
      and(
        eq(formIntegrations.formId, formId),
        eq(formIntegrations.workspaceId, ctx.workspaceId),
        eq(formIntegrations.type, "notion"),
      ),
    )
    .limit(1)

  if (existing) {
    await db.update(formIntegrations).set({ enabled: false }).where(eq(formIntegrations.id, existing.id))
  } else {
    const [form] = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId), isNull(forms.deletedAt)))
      .limit(1)
    const conn = await workspaceConnection(ctx, "notion")
    if (!form || !conn) return { success: false, error: "Nothing to pause" }
    await db.insert(formIntegrations).values({
      formId,
      workspaceId: ctx.workspaceId,
      type: "notion",
      enabled: false,
      config: { databaseId: "", titlePropertyName: TITLE_PROP, properties: [] },
    })
  }

  invalidate(ctx, { paths: [`/forms/${formId}/integrations`, "/integrations"] })
  return { success: true }
}

/**
 * Disconnect the workspace's Notion account (global off-switch). Deletes the
 * grant and disables every form's Notion sync (databases are left intact).
 */
export async function disconnectNotion(ctx: AuthContext, returnFormId?: string): Promise<Result> {

  await db.transaction(async (tx) => {
    await tx
      .update(formIntegrations)
      .set({ enabled: false })
      .where(
        and(
          eq(formIntegrations.workspaceId, ctx.workspaceId),
          eq(formIntegrations.type, "notion"),
        ),
      )
    await tx
      .delete(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, ctx.workspaceId),
          eq(workspaceConnections.provider, "notion"),
        ),
      )
  })

  invalidate(ctx, {
    paths: returnFormId
      ? [`/forms/${returnFormId}/integrations`, "/integrations"]
      : ["/integrations"],
  })
  return { success: true }
}

// ── Reads, projected for callers ───────────────────────────────────────────

export type ConnectionView = {
  provider: "google" | "notion"
  connected: boolean
  /** Whose account it is. PII, but the owner set it and needs to see it. */
  accountEmail: string | null
}

/**
 * Which providers this workspace has connected.
 *
 * A projection, not a row: `accessToken` and `refreshToken` are never selected,
 * so they cannot reach a caller even by accident. This is the only description
 * of a connection that leaves this module.
 */
export async function describeConnections(ctx: AuthContext): Promise<ConnectionView[]> {
  const rows = await db
    .select({
      provider: workspaceConnections.provider,
      accountEmail: workspaceConnections.accountEmail,
    })
    .from(workspaceConnections)
    .where(eq(workspaceConnections.workspaceId, ctx.workspaceId))

  const byProvider = new Map(rows.map((r) => [r.provider, r.accountEmail]))
  return (["google", "notion"] as const).map((provider) => ({
    provider,
    connected: byProvider.has(provider),
    accountEmail: byProvider.get(provider) ?? null,
  }))
}

export type FormSyncView = {
  formId: string
  type: "google_sheets" | "notion"
  enabled: boolean
  /** The user-visible deep link to the sheet or database. Not a credential. */
  url: string | null
}

/**
 * Per-form Sheets/Notion sync state for one workspace.
 *
 * Reads only the two config keys that are safe to show. It deliberately does
 * NOT reuse `getWorkspaceIntegrations`, which selects the raw `config` column
 * for every integration row — webhook secrets and Discord URLs included — and
 * relies on a hand-written per-type mapping to keep them out of its return. One
 * "just spread the config" edit there leaks both; this projects at the query.
 */
export async function describeFormSyncs(ctx: AuthContext): Promise<FormSyncView[]> {
  const rows = await db
    .select({
      formId: formIntegrations.formId,
      type: formIntegrations.type,
      enabled: formIntegrations.enabled,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(eq(formIntegrations.workspaceId, ctx.workspaceId))

  return rows
    .filter((r) => r.type === "google_sheets" || r.type === "notion")
    .map((r) => {
      const cfg = r.config as Partial<GoogleSheetsIntegrationConfig & NotionIntegrationConfig>
      return {
        formId: r.formId,
        type: r.type as "google_sheets" | "notion",
        enabled: r.enabled,
        url: cfg.spreadsheetUrl ?? cfg.databaseUrl ?? null,
      }
    })
}
