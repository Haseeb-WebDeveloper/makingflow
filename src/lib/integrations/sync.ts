import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
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
  appendRow,
  appendRows,
  deleteRow,
  getColumnValues,
  getSheetId,
  getValidAccessToken,
  DEFAULT_SHEET_NAME,
} from "@/lib/integrations/google"
import { createFormSheet, reconcileFormSheet } from "@/lib/integrations/sheets-provision"
import { answerToCell } from "@/lib/submissions/answer-format"
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
 * Best-effort: deliver one submission to Google Sheets under the GLOBAL model.
 *
 * The workspace Google connection is the on-switch — if it exists, every form
 * syncs automatically. A form's spreadsheet is created LAZILY here on its first
 * response. A form can be individually paused (a disabled `form_integrations`
 * row). On every sync the sheet is reconciled to the form first, so newly added
 * questions show up as columns automatically.
 *
 * Called AFTER the submission commits; it must never throw into the submit path
 * — a Sheets outage can't block a respondent.
 */
export async function syncSubmissionToSheets(
  form: { id: string; workspaceId: string; title: string },
  answers: { fieldId: string; value: AnswerValue }[],
  submittedAt: Date,
  submissionId: string,
): Promise<void> {
  try {
    const conn = await googleConnection(form.workspaceId)
    if (!conn) return

    const row = await sheetIntegration(form.id)
    if (row && !row.enabled) return // explicitly paused for this form

    let config = row?.config as GoogleSheetsIntegrationConfig | undefined

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
        if (!winner?.enabled || !winnerConfig?.spreadsheetId) return
        config = winnerConfig
        // Fall through to the normal append so THIS response still lands. The
        // winner's own backfill covers the history.
      } else {
        // The sheet is brand-new. Write EVERY completed response (this one
        // included, as it's already committed) so connecting Sheets after
        // responses exist backfills the history — not just rows from now on.
        await backfillFormSheet(conn, created, form.id)
        return
      }
    }

    // Grow columns for any new fields (and migrate old sheets to the id column).
    const reconciled = await reconcileFormSheet(conn, config, form.id)
    config = reconciled.config
    if (reconciled.changed && row) {
      await db
        .update(formIntegrations)
        .set({ config })
        .where(eq(formIntegrations.id, row.id))
    }

    const accessToken = await getValidAccessToken(conn)
    const answerByField = new Map(answers.map((a) => [a.fieldId, a.value]))
    const columns = config.columns ?? []
    const cells = [
      submittedAt.toISOString(),
      ...columns.map((c) => cell(answerByField.get(c.fieldId))),
    ]
    // Lead with the submission id when the sheet tracks it (so the row can later
    // be found and deleted); legacy sheets without it just get the data columns.
    const values = config.hasIdColumn ? [submissionId, ...cells] : cells
    await appendRow(accessToken, config.spreadsheetId, config.sheetName ?? DEFAULT_SHEET_NAME, values)
  } catch (err) {
    console.error("[sync] google sheets delivery failed", err)
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
    if (row) return // already has a sheet (or is paused) — leave it as-is.

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
 * Idempotent: rows whose Submission ID is already present (column A) are skipped,
 * so it's safe to run again (e.g. re-enabling a form). Requires the id-column
 * layout to dedup — a no-op on legacy sheets that lack it. Returns how many rows
 * it wrote; never throws into the caller.
 */
export async function backfillFormSheet(
  conn: WorkspaceConnection,
  config: GoogleSheetsIntegrationConfig,
  formId: string,
): Promise<number> {
  try {
    if (!config.spreadsheetId || !config.hasIdColumn) return 0
    const accessToken = await getValidAccessToken(conn)
    const sheetName = config.sheetName ?? DEFAULT_SHEET_NAME

    // Submission ids already in the sheet (skip the header at index 0) so a
    // re-run never duplicates a row.
    const present = new Set(
      (await getColumnValues(accessToken, config.spreadsheetId, sheetName, "A")).slice(1),
    )

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

    const columns = config.columns ?? []
    const values = pending.map((s) => {
      const byField = bySubmission.get(s.id) ?? new Map<string, AnswerValue>()
      const submittedAt = (s.completedAt ?? s.createdAt).toISOString()
      return [s.id, submittedAt, ...columns.map((c) => cell(byField.get(c.fieldId)))]
    })

    for (let i = 0; i < values.length; i += BACKFILL_CHUNK) {
      await appendRows(accessToken, config.spreadsheetId, sheetName, values.slice(i, i + BACKFILL_CHUNK))
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
 * leading Submission ID column. No-op for paused forms, disconnected workspaces,
 * or legacy sheets that predate id tracking. Never throws into the caller.
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
    if (!config?.spreadsheetId || !config.hasIdColumn) return // can't locate the row

    const accessToken = await getValidAccessToken(conn)
    const sheetName = config.sheetName ?? DEFAULT_SHEET_NAME

    let sheetId = config.sheetId ?? null
    if (sheetId == null) sheetId = await getSheetId(accessToken, config.spreadsheetId, sheetName)
    if (sheetId == null) return // no way to target the row for deletion

    // Column A holds the submission ids (incl. the header at index 0).
    const ids = await getColumnValues(accessToken, config.spreadsheetId, sheetName, "A")
    const rowIndex = ids.findIndex((v, i) => i > 0 && v === submissionId)
    if (rowIndex < 0) return // already gone, or never synced

    await deleteRow(accessToken, config.spreadsheetId, sheetId, rowIndex)
  } catch (err) {
    console.error("[sync] google sheets row deletion failed", err)
  }
}
