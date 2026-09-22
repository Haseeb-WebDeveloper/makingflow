import "server-only"

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  answers,
  forms,
  formIntegrations,
  submissions,
  workspaceConnections,
  type AnswerValue,
  type GoogleSheetsIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  appendCellRows,
  appendCells,
  deleteRow,
  getValidAccessToken,
  readGridColumn,
} from "@/lib/integrations/google"
import {
  createFormSheet,
  isOrphanedSheetConfig,
  reconcileFormSheet,
} from "@/lib/integrations/sheets-provision"
import { buildRow, type SheetLayout } from "@/lib/integrations/sheet-layout"
import { reconcileSheetShares } from "@/lib/integrations/sheets-sharing"
import { answerToCell } from "@/lib/submissions/answer-format"
import type { DeliveryContent, SendOutcome } from "@/lib/integrations/submission-content"
import { neutralizeFormula } from "@/lib/submissions/csv"
import type { AnswerValue as AnswerValueForCell } from "@/lib/db/schema"

/**
 * One Sheets cell from an answer value.
 *
 * Sheets rows are written with `valueInputOption=USER_ENTERED` so that a file
 * URL becomes a clickable link — which also means a respondent answer starting
 * with `=` is stored as a live formula in the owner's spreadsheet. The guard
 * makes text literal without touching URLs.
 */
function cell(value: AnswerValueForCell | undefined): string {
  return neutralizeFormula(answerToCell(value))
}

/**
 * The submission ids already in the sheet, by the layout's own reckoning.
 *
 * Everything above the header row is skipped — which used to be hardcoded as
 * "row 1". When the owner had inserted a row above the header, that dropped a
 * REAL submission id from the set, and the retry it was meant to stop appended
 * the response a second time.
 */
async function presentIds(
  accessToken: string,
  spreadsheetId: string,
  layout: SheetLayout,
): Promise<string[]> {
  const column = await readGridColumn(accessToken, spreadsheetId, layout.sheetId, layout.idColumn)
  return column.slice(layout.headerRow + 1)
}

/** The workspace's Google connection (the global Sheets on-switch), or null. */
async function googleConnection(workspaceId: string): Promise<WorkspaceConnection | null> {
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

/** This form's google_sheets integration row (enabled or not), or null. */
async function sheetIntegration(formId: string) {
  const [row] = await db
    .select()
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)
  return row ?? null
}

/**
 * Give a form a fresh spreadsheet in the CURRENTLY connected account, replacing
 * a config left behind by a previous one.
 *
 * Switching the workspace's Google account does not move the files: the old
 * account keeps every spreadsheet, and every form still names one. Reconnecting
 * used to leave those forms pointing at a file the new token gets 403/404 on,
 * visible only in the logs — each response simply failed to land. A new sheet in
 * the new Drive, backfilled with the history, is the only outcome that matches
 * what connecting an account is understood to mean. The old spreadsheet is left
 * untouched in the old account, as the archive it now is.
 *
 * Race-safe the way the lazy-create branch is: the UPDATE is guarded on the
 * stale connection id, so if a concurrent response re-provisioned first, ours
 * loses and returns null rather than pointing the form at a second new sheet.
 */
async function reprovisionOrphanedSheet(
  conn: WorkspaceConnection,
  form: { id: string; title: string },
  rowId: string,
  stale: GoogleSheetsIntegrationConfig,
): Promise<GoogleSheetsIntegrationConfig | null> {
  const config = await createFormSheet(conn, form.id, form.title)
  const [claimed] = await db
    .update(formIntegrations)
    .set({ config })
    .where(
      and(
        eq(formIntegrations.id, rowId),
        sql`${formIntegrations.config} ->> 'connectionId' = ${stale.connectionId}`,
      ),
    )
    .returning({ id: formIntegrations.id })

  if (!claimed) {
    console.warn(
      `[sync] lost sheet re-provisioning for form ${form.id}; orphan spreadsheet ${config.spreadsheetId}`,
    )
    return null
  }

  // The new sheet is empty and every response predates it, so the history is the
  // backfill's job — exactly as on first provisioning.
  await backfillFormSheet(conn, config, form.id)
  // A replacement file carries none of the old file's permissions, so without
  // this an account switch silently locks the rest of the team out.
  await reconcileSheetShares(conn, { id: rowId, formId: form.id, config })
  return config
}

/**
 * Deliver one submission to Google Sheets under the GLOBAL model.
 *
 * The workspace Google connection is the on-switch — if it exists, every form
 * syncs automatically. A form's spreadsheet is created LAZILY here on its first
 * response. A form can be individually paused (a disabled `form_integrations`
 * row). On every sync the sheet is reconciled to the form first, so newly added
 * questions show up as columns automatically.
 *
 * REPORTS ITS OUTCOME rather than swallowing it. This used to run from after()
 * and console.error a failure, which meant a response missing from someone's
 * spreadsheet was also a response nobody could find out about. It is driven by
 * the delivery queue now, so a failure is recorded, retried and visible.
 *
 * `verifyFirst` is what makes retrying safe. An append is not idempotent: if the
 * row landed and the response timed out on our side, retrying blindly writes it
 * twice. When set, the submission id is looked up in column A before appending,
 * and a delivery already present is reported as delivered rather than repeated.
 * The caller passes it on retries only — on a first attempt the answer is known
 * and the extra API call would be waste.
 *
 * Still never throws: a Sheets outage becomes a failed outcome, not an
 * exception into the sweep.
 */
export async function syncSubmissionToSheets(
  content: DeliveryContent,
  opts: { verifyFirst?: boolean } = {},
): Promise<SendOutcome> {
  const form = content.form
  const answers = content.answers
  const submittedAt = content.submission.submittedAt
  const submissionId = content.submission.id

  try {
    const conn = await googleConnection(form.workspaceId)
    // Not a transient failure: without a connection there is no destination,
    // and retrying for hours will not create one.
    if (!conn) return { ok: false, error: "Google is not connected", permanent: true }

    const row = await sheetIntegration(form.id)
    if (row && !row.enabled) {
      // Paused between enqueue and send. Pausing has to stop the backlog too,
      // or "pause" means "pause new ones and keep writing the old ones".
      return { ok: false, error: "Google Sheets is paused for this form", permanent: true }
    }

    let config = row?.config as GoogleSheetsIntegrationConfig | undefined

    // The workspace has connected a DIFFERENT Google account since this sheet was
    // made, so its spreadsheet sits in the old account's Drive where the current
    // token cannot reach it. Move the form onto a sheet this account owns instead
    // of failing this response and every one after it.
    if (row && config && isOrphanedSheetConfig(config, conn.id)) {
      const fresh = await reprovisionOrphanedSheet(conn, form, row.id, config)
      // The backfill covers this submission too — it is already committed.
      if (fresh) return { ok: true }

      // A concurrent response re-provisioned first; deliver into the sheet it
      // claimed rather than treating that as a failure.
      const winner = await sheetIntegration(form.id)
      const winnerConfig = winner?.config as GoogleSheetsIntegrationConfig | undefined
      if (!winner?.enabled || !winnerConfig?.spreadsheetId) {
        return { ok: false, error: "Google Sheets is paused for this form", permanent: true }
      }
      config = winnerConfig
    }

    if (!config) {
      // First response since the workspace connected — provision now and store it.
      //
      // Responses arrive concurrently, so two of them can both find no config
      // and both provision. `form_integrations_singleton_idx` makes exactly one
      // insert win; the loser must NOT proceed as if it owned the destination,
      // or the form ends up split across two spreadsheets.
      const created = await createFormSheet(conn, form.id, form.title)
      const [claimed] = await db
        .insert(formIntegrations)
        .values({
          formId: form.id,
          workspaceId: form.workspaceId,
          type: "google_sheets",
          enabled: true,
          config: created,
        })
        .onConflictDoNothing()
        .returning({ id: formIntegrations.id })

      if (!claimed) {
        // Lost the race. The spreadsheet we just made is an orphan — left in the
        // user's Drive rather than deleted, since it's now visible to them and
        // deleting someone's file to tidy up is worse than an empty extra sheet.
        console.warn(
          `[sync] lost sheet provisioning for form ${form.id}; orphan spreadsheet ${created.spreadsheetId}`,
        )
        const winner = await sheetIntegration(form.id)
        const winnerConfig = winner?.config as GoogleSheetsIntegrationConfig | undefined
        if (!winner?.enabled || !winnerConfig?.spreadsheetId) {
          return { ok: false, error: "Google Sheets is paused for this form", permanent: true }
        }
        config = winnerConfig
        // Fall through to the normal append so THIS response still lands. The
        // winner's own backfill covers the history.
      } else {
        // The sheet is brand-new. Write EVERY completed response (this one
        // included, as it's already committed) so connecting Sheets after
        // responses exist backfills the history — not just rows from now on.
        //
        // The backfill skips submission ids already in the sheet, so it is
        // safe to reach twice and this delivery is covered by it.
        await backfillFormSheet(conn, created, form.id)
        await reconcileSheetShares(conn, { id: claimed.id, formId: form.id, config: created })
        return { ok: true }
      }
    }

    // Find out where this sheet's columns ACTUALLY are, tagging or repairing it
    // as needed, and grow it for any question added since the last delivery.
    const reconciled = await reconcileFormSheet(conn, config, form.id)
    config = reconciled.config
    const layout = reconciled.layout
    if (reconciled.changed) {
      // Guarded on the row we have, or — when a concurrent delivery won the
      // provisioning race and we adopted its config — on the row it created.
      // Skipping the write in that case left the grown column list unpersisted,
      // so the next delivery redid the whole repair.
      const target = row?.id ?? (await sheetIntegration(form.id))?.id
      if (target) {
        await db.update(formIntegrations).set({ config }).where(eq(formIntegrations.id, target))
      }
    }

    // Nothing addressable — no resolvable sheet id. Fail rather than write into
    // a sheet whose shape we could not establish.
    if (!layout) {
      return { ok: false, error: "Could not resolve the spreadsheet's layout" }
    }

    const accessToken = await getValidAccessToken(conn)

    // ── The retry-safety check ──
    //
    // Appending is not idempotent, and the failure that matters is the one
    // where the row DID land and we never heard back. The id column holds the
    // submission ids for exactly this kind of lookup — it is what
    // deleteSubmissionFromSheet and the backfill also use.
    //
    // Only on a retry: the first attempt knows it has not sent anything, and
    // the check costs an API round-trip per delivery.
    if (opts.verifyFirst) {
      const present = await presentIds(accessToken, config.spreadsheetId, layout)
      if (present.includes(submissionId)) {
        return { ok: true }
      }
    }

    const answerByField = new Map(answers.map((a) => [a.fieldId, a.value]))
    const byField = new Map<string, string>()
    for (const fieldId of layout.fieldColumns.keys()) {
      byField.set(fieldId, cell(answerByField.get(fieldId)))
    }
    await appendCells(
      accessToken,
      config.spreadsheetId,
      layout.sheetId,
      buildRow(layout, {
        submissionId,
        submittedAt: submittedAt.toISOString(),
        byField,
      }),
    )
    return { ok: true }
  } catch (err) {
    // Retryable by default: a Google outage, an expired token, a rate limit.
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Eagerly create a form's Google spreadsheet so it exists BEFORE any response
 * arrives. Under the global model the sheet is otherwise provisioned lazily on
 * the first submission (see {@link syncSubmissionToSheets}); this brings it
 * forward — e.g. on publish — so a live form already has an empty, ready
 * destination at 0 rows.
 *
 * No-op when the workspace hasn't connected Google, or when the form already has
 * a Sheets integration row (already provisioned, or explicitly paused — we never
 * override the user's choice). Mirrors the lazy-create branch below. Best-effort:
 * never throws, so it's safe to call off the response path.
 */
export async function ensureFormSheet(form: {
  id: string
  workspaceId: string
  title: string
}): Promise<void> {
  try {
    const conn = await googleConnection(form.workspaceId)
    if (!conn) return // Sheets not connected for this workspace — nothing to do.

    const row = await sheetIntegration(form.id)
    const existing = row?.config as GoogleSheetsIntegrationConfig | undefined
    if (row) {
      // A sheet from a previously connected account is not a sheet this account
      // can write to, so it does not count as "already provisioned". Only for a
      // form that is actually syncing: a paused form gets its new sheet when
      // someone resumes it (see enableFormSheet), not from a reconnect it never
      // asked to be part of.
      if (row.enabled && existing && isOrphanedSheetConfig(existing, conn.id)) {
        await reprovisionOrphanedSheet(conn, form, row.id, existing)
      }
      return // already has a sheet (or is paused) — leave it as-is.
    }

    const config = await createFormSheet(conn, form.id, form.title)
    const [claimed] = await db
      .insert(formIntegrations)
      .values({
        formId: form.id,
        workspaceId: form.workspaceId,
        type: "google_sheets",
        enabled: true,
        config,
      })
      .onConflictDoNothing()
      .returning({ id: formIntegrations.id })
    if (!claimed) {
      // A response provisioned the form's sheet between our read and this
      // insert. Theirs is the destination; ours is an orphan.
      console.warn(
        `[sync] sheet already provisioned for form ${form.id}; orphan spreadsheet ${config.spreadsheetId}`,
      )
      return
    }
    // Creating the sheet here PRE-EMPTS the lazy branch above, which was the
    // only path that ever carried existing responses across — without this, a
    // workspace that connects after collecting responses gets an empty sheet
    // and rows only from the next submission on.
    await backfillFormSheet(conn, config, form.id)
    await reconcileSheetShares(conn, { id: claimed.id, formId: form.id, config })
  } catch (err) {
    console.error("[sync] eager google sheet provisioning failed", err)
  }
}


/**
 * Provision spreadsheets for every already-published form in a workspace — run once,
 * just after Google is connected.
 *
 * Connecting is the moment the user expects their forms to have somewhere to
 * land. Without this, a workspace that connects AFTER publishing its forms sees
 * every one of them sitting at "not created yet" until a response happens to
 * arrive.
 *
 * Serial and capped: Google rate-limits, and each form costs several API
 * calls. Forms beyond the cap are provisioned on publish or on first response
 * as before. Best-effort — never throws into the OAuth callback.
 */
export async function ensureWorkspaceSheets(workspaceId: string): Promise<void> {
  try {
    const rows = await db
      .select({ id: forms.id, title: forms.title })
      .from(forms)
      .where(
        and(
          eq(forms.workspaceId, workspaceId),
          eq(forms.status, "published"),
          isNull(forms.deletedAt),
        ),
      )
      .orderBy(desc(forms.updatedAt))
      .limit(MAX_CONNECT_PROVISION)

    for (const f of rows) {
      await ensureFormSheet({ id: f.id, workspaceId, title: f.title })
    }
  } catch (err) {
    console.error("[sync] workspace sheet provisioning failed", err)
  }
}

/** How many published forms to provision when a workspace connects. */
const MAX_CONNECT_PROVISION = 25

/**
 * Historical rows one backfill will write for a single form. Sheets takes them
 * in bulk, so this bounds memory and request size rather than wall-clock — it
 * sits far above the Notion cap for that reason. Re-running picks up the rest.
 */
const MAX_SHEET_BACKFILL = 5000

/** Rows per append call — one 5,000-row request risks Sheets' payload limit. */
const BACKFILL_CHUNK = 500

/**
 * Bulk-deliver every completed submission a form already has into its sheet.
 * Runs when Sheets is connected/enabled AFTER responses exist, so the sheet
 * shows the full history rather than only rows that arrive from then on.
 *
 * Idempotent: rows whose Submission ID is already present are skipped, so it's
 * safe to run again (e.g. re-enabling a form). Resolves the sheet's live layout
 * first, so a backfill into a sheet the owner has rearranged still puts every
 * answer under its own header. Returns how many rows it wrote; never throws
 * into the caller.
 */
export async function backfillFormSheet(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<number> {
  try {
    if (!config.spreadsheetId) return 0
    const { layout } = await reconcileFormSheet(conn, config, formId)
    if (!layout) return 0
    const accessToken = await getValidAccessToken(conn)

    // Submission ids already in the sheet (everything below the header) so a
    // re-run never duplicates a row.
    const present = new Set(await presentIds(accessToken, config.spreadsheetId, layout))

    const subs = await db
      .select({
        id: submissions.id,
        completedAt: submissions.completedAt,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(and(eq(submissions.formId, formId), eq(submissions.status, "completed")))
      .orderBy(submissions.createdAt)

    // Oldest first (the query orders by createdAt), so a capped run leaves a
    // contiguous gap at the recent end that the next run fills.
    const missing = subs.filter((s) => !present.has(s.id))
    if (missing.length === 0) return 0
    const pending = missing.slice(0, MAX_SHEET_BACKFILL)
    if (missing.length > pending.length) {
      console.warn(
        `[sync] sheet backfill capped at ${pending.length} of ${missing.length} responses for form ${formId}; re-run to continue`,
      )
    }

    // Load all answers for the pending submissions in one query, indexed by
    // submission → field. AI follow-ups (null fieldId) have no column, so skip.
    const answerRows = await db
      .select({
        submissionId: answers.submissionId,
        fieldId: answers.fieldId,
        value: answers.value,
      })
      .from(answers)
      .where(inArray(answers.submissionId, pending.map((s) => s.id)))

    const bySubmission = new Map<string, Map<string, AnswerValue>>()
    for (const a of answerRows) {
      if (!a.fieldId) continue
      let fields = bySubmission.get(a.submissionId)
      if (!fields) bySubmission.set(a.submissionId, (fields = new Map()))
      fields.set(a.fieldId, a.value)
    }

    const values = pending.map((s) => {
      const answered = bySubmission.get(s.id) ?? new Map<string, AnswerValue>()
      const byField = new Map<string, string>()
      for (const fieldId of layout.fieldColumns.keys()) {
        byField.set(fieldId, cell(answered.get(fieldId)))
      }
      return buildRow(layout, {
        submissionId: s.id,
        submittedAt: (s.completedAt ?? s.createdAt).toISOString(),
        byField,
      })
    })

    for (let i = 0; i < values.length; i += BACKFILL_CHUNK) {
      await appendCellRows(
        accessToken,
        config.spreadsheetId,
        layout.sheetId,
        values.slice(i, i + BACKFILL_CHUNK),
      )
    }
    return values.length
  } catch (err) {
    console.error("[sync] google sheets backfill failed", err)
    return 0
  }
}

/**
 * Best-effort: remove a submission's row from its Google Sheet (called when the
 * owner deletes the submission in MakingFlow). Finds the row by its id in the
 * resolved Submission ID column, wherever the owner has since moved it. No-op
 * for paused forms and disconnected workspaces. Never throws into the caller.
 */
export async function deleteSubmissionFromSheet(
  form: { id: string; workspaceId: string },
  submissionId: string,
): Promise<void> {
  try {
    const conn = await googleConnection(form.workspaceId)
    if (!conn) return

    const row = await sheetIntegration(form.id)
    if (!row || !row.enabled) return
    const config = row.config as GoogleSheetsIntegrationConfig
    if (!config?.spreadsheetId) return

    const { layout } = await reconcileFormSheet(conn, config, form.id)
    if (!layout) return // no way to target the row for deletion

    const accessToken = await getValidAccessToken(conn)

    // Search the WHOLE id column, header included. A row above the header is
    // still a row somebody's response is sitting in — skipping index 0 on
    // principle is what left those undeletable.
    const ids = await readGridColumn(
      accessToken,
      config.spreadsheetId,
      layout.sheetId,
      layout.idColumn,
    )
    const rowIndex = ids.findIndex((v, i) => i !== layout.headerRow && v === submissionId)
    if (rowIndex < 0) return // already gone, or never synced
    const sheetId = layout.sheetId

    await deleteRow(accessToken, config.spreadsheetId, sheetId, rowIndex)
  } catch (err) {
    console.error("[sync] google sheets row deletion failed", err)
  }
}
