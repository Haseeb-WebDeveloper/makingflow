import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  users,
  workspaceConnections,
  workspaceMembers,
  type GoogleSheetsIntegrationConfig,
  type SheetShare,
  type SheetSharingSetting,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  DriveShareError,
  getValidAccessToken,
  shareFile,
  unshareFile,
} from "@/lib/integrations/google"

/**
 * Giving the workspace's members access to the spreadsheets a connected Google
 * account owns.
 *
 * The files live in one person's Drive, so without this the only way a teammate
 * sees the responses in Sheets is for that person to open every spreadsheet and
 * add them by hand — once per form, again for every new form, and again for every
 * new member. This module holds the decision (who should have access, what has to
 * change) and the application of it (the Drive calls, and what we record).
 */

/** Case-insensitive, whitespace-free comparison key for an address. */
const key = (email: string) => email.trim().toLowerCase()

/**
 * Which setting governs one spreadsheet: its own, or the workspace's.
 *
 * A form's setting beats the workspace in both directions — it can share a form
 * the workspace does not, and `{ general: null }` keeps a form private while
 * everything else is shared.
 */
export function resolveSharing(
  workspace: SheetSharingSetting | undefined,
  own: SheetSharingSetting | undefined,
): SheetSharingSetting | undefined {
  return own ?? workspace
}

/**
 * Who should be able to open this spreadsheet, and as what.
 *
 * General access applies to every member; a named person's own role replaces it,
 * and `'none'` removes them. The account that owns the files is always left out:
 * Drive refuses to share a file with its owner, and recording that refusal would
 * park a permanent failure against the one person who certainly has access.
 */
export function desiredRoles(
  setting: SheetSharingSetting | undefined,
  memberEmails: string[],
  ownerEmail: string,
): Map<string, 'reader' | 'writer'> {
  const out = new Map<string, 'reader' | 'writer'>()
  if (!setting) return out

  const owner = key(ownerEmail)
  const named = new Map((setting.people ?? []).map((p) => [key(p.email), p.role]))

  for (const email of memberEmails) {
    const k = key(email)
    if (k === owner || out.has(k)) continue
    const role = named.get(k) ?? setting.general
    if (role && role !== 'none') out.set(email, role)
  }
  return out
}

/**
 * What has to change on one spreadsheet for the right people to have the right
 * role.
 *
 * THE RULE: `revoke` only ever contains entries carrying a `permissionId` we
 * recorded. An entry without one is either a failed attempt of ours or a share
 * the account's owner made by hand in Drive — and removing somebody's manual
 * share to tidy up our own bookkeeping is a far worse bug than leaving a stale
 * grant in place.
 *
 * A role change is expressed as a revoke plus a grant rather than a patch: one
 * code path instead of two, and the id we have recorded stays true at every step.
 */
export function planShareChanges(
  desired: Map<string, 'reader' | 'writer'>,
  current: SheetShare[],
): {
  grant: { email: string; role: 'reader' | 'writer' }[]
  revoke: SheetShare[]
  keep: SheetShare[]
} {
  const wanted = new Map([...desired].map(([email, role]) => [key(email), { email, role }]))
  const grant: { email: string; role: 'reader' | 'writer' }[] = []
  const revoke: SheetShare[] = []
  const keep: SheetShare[] = []

  for (const share of current) {
    const k = key(share.email)
    const want = wanted.get(k)
    const isOurs = Boolean(share.permissionId)

    if (want && want.role === share.role && isOurs) {
      keep.push(share)
      wanted.delete(k)
      continue
    }
    if (isOurs) revoke.push(share)
    // An entry with no permissionId is left for the grant loop to retry (if still
    // wanted) or simply forgotten (if not). Never revoked.
  }

  for (const want of wanted.values()) grant.push(want)
  return { grant, revoke, keep }
}

/** How many sheets one workspace-wide reconcile touches. Google rate-limits. */
const MAX_RECONCILE_SHEETS = 25

/** The workspace's member addresses, in a stable order. */
async function memberEmails(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(users.email)
  return rows.map((r) => r.email)
}

/**
 * Make one spreadsheet's access match the workspace's setting.
 *
 * Best-effort by design: every Drive failure is recorded against the person it
 * concerns and the remaining work continues. Sharing sits on top of delivery — a
 * Drive outage must not cost anybody a response, and must never stop a sheet from
 * being provisioned.
 *
 * The write is guarded on the config still naming this connection, so a
 * concurrent account switch (which replaces the spreadsheet outright) wins
 * instead of having grants for a dead file written back over it.
 */
export async function reconcileSheetShares(
  conn: WorkspaceConnection,
  row: { id: string; formId: string; config: GoogleSheetsIntegrationConfig },
): Promise<void> {
  try {
    const config = row.config
    if (!config.spreadsheetId) return // nothing provisioned yet, nothing to share

    const setting = resolveSharing(conn.metadata?.google?.share, config.shareOverride)
    const desired = desiredRoles(
      setting,
      await memberEmails(conn.workspaceId),
      conn.accountEmail,
    )
    const { grant, revoke, keep } = planShareChanges(desired, config.shares ?? [])
    if (!grant.length && !revoke.length) return

    const accessToken = await getValidAccessToken(conn)
    const next: SheetShare[] = [...keep]

    for (const share of revoke) {
      try {
        await unshareFile(accessToken, config.spreadsheetId, share.permissionId!)
      } catch (err) {
        // Keep the record. A grant we failed to withdraw still exists, and
        // forgetting its id would strand it on the file forever.
        next.push({ ...share, error: err instanceof DriveShareError ? err.kind : "failed" })
      }
    }

    for (const { email, role } of grant) {
      try {
        const { permissionId } = await shareFile(accessToken, config.spreadsheetId, email, role)
        next.push({ email, role, permissionId, syncedAt: new Date().toISOString() })
      } catch (err) {
        next.push({ email, role, error: err instanceof DriveShareError ? err.kind : "failed" })
      }
    }

    await db
      .update(formIntegrations)
      .set({ config: { ...config, shares: next } })
      .where(
        and(
          eq(formIntegrations.id, row.id),
          sql`${formIntegrations.config} ->> 'connectionId' = ${config.connectionId}`,
        ),
      )
  } catch (err) {
    console.error("[sharing] reconcile failed", err)
  }
}

/**
 * Bring every sheet in a workspace in line — the setting changed, or the
 * membership did. Serial and capped for the same reason `ensureWorkspaceSheets`
 * is: each sheet costs a Drive call per person, and Google rate-limits.
 */
export async function reconcileWorkspaceSheetShares(workspaceId: string): Promise<void> {
  try {
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
    if (!conn) return

    const rows = await db
      .select({
        id: formIntegrations.id,
        formId: formIntegrations.formId,
        config: formIntegrations.config,
      })
      .from(formIntegrations)
      .innerJoin(forms, eq(forms.id, formIntegrations.formId))
      .where(
        and(
          eq(formIntegrations.workspaceId, workspaceId),
          eq(formIntegrations.type, "google_sheets"),
          isNull(forms.deletedAt),
        ),
      )
      .orderBy(desc(formIntegrations.updatedAt))
      .limit(MAX_RECONCILE_SHEETS)

    for (const row of rows) {
      await reconcileSheetShares(conn, {
        id: row.id,
        formId: row.formId,
        config: row.config as GoogleSheetsIntegrationConfig,
      })
    }
    // Say so rather than letting a partial pass read as a complete one.
    if (rows.length === MAX_RECONCILE_SHEETS) {
      console.warn(
        `[sharing] reconciled the ${MAX_RECONCILE_SHEETS} most recently updated sheets for workspace ${workspaceId}; older ones are covered on their next change`,
      )
    }
  } catch (err) {
    console.error("[sharing] workspace reconcile failed", err)
  }
}
