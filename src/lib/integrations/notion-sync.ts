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
  type NotionIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import { decrypt } from "@/lib/integrations/crypto"
import {
  archivePage,
  createDatabasePage,
  listDatabaseTitles,
  queryDatabaseByTitle,
} from "@/lib/integrations/notion"
import { createFormDatabase, reconcileFormDatabase } from "@/lib/integrations/notion-provision"
import { answerFiles, answerToCell } from "@/lib/submissions/answer-format"

/** How many published forms to provision when a workspace connects. */
const MAX_CONNECT_PROVISION = 25

/**
 * Historical pages one backfill will write for a single form.
 *
 * Notion has no bulk-create — every page is its own request — so unlike the
 * Sheets backfill (one `appendRows` call) this is bounded by wall-clock, not by
 * payload size. A form past the cap keeps its oldest responses out of Notion;
 * re-running the per-form toggle picks up where this left off, since the
 * backfill skips what's already there.
 *
 * Sized to finish inside the 60s maxDuration set on the routes that trigger it:
 * at ~3 requests/second this is ~42s of writing plus the scan that precedes it.
 */
const MAX_FORM_BACKFILL = 120

/**
 * Historical pages one workspace-connect sweep will write across ALL its forms.
 * Without it, 25 forms × the per-form cap is sequential requests measured in
 * hours — the run would be killed mid-way with nobody told.
 */
const MAX_CONNECT_BACKFILL = 120

/**
 * Notion allows roughly 3 requests/second per integration and answers a burst
 * with 429s. Pacing below that keeps a long backfill from getting itself
 * throttled — the run is already in the background, so the wall-clock is free.
 */
const BACKFILL_INTERVAL_MS = 350

/** Consecutive page failures that mean the run is broken (429, revoked token). */
const BACKFILL_ABORT_AFTER = 5

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Notion's per-option / text length limits. */
const MAX_TEXT = 2000
const MAX_OPTION = 100

/** The workspace's Notion connection (the global on-switch), or null. */
async function notionConnection(workspaceId: string): Promise<WorkspaceConnection | null> {
  const [conn] = await db
    .select()
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspaceId),
        eq(workspaceConnections.provider, "notion"),
      ),
    )
    .limit(1)
  return conn ?? null
}

/** This form's notion integration row (enabled or not), or null. */
async function notionIntegration(formId: string) {
  const [row] = await db
    .select()
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "notion")))
    .limit(1)
  return row ?? null
}

const clampText = (s: string) => s.slice(0, MAX_TEXT)
const clampOption = (s: string) => s.slice(0, MAX_OPTION)

/** Build a typed Notion property value for one answer. */
function toNotionValue(type: string, value: AnswerValue | undefined): unknown {
  switch (type) {
    case "email":
      return { email: value ? clampText(String(value)) : null }
    case "phone_number":
      return { phone_number: value ? clampText(String(value)) : null }
    case "url":
      return { url: value ? clampText(String(value)) : null }
    case "number": {
      const n = typeof value === "number" ? value : Number(value)
      return { number: Number.isFinite(n) ? n : null }
    }
    case "select": {
      const s = answerToCell(value)
      return { select: s ? { name: clampOption(s) } : null }
    }
    case "multi_select": {
      const arr = Array.isArray(value)
        ? value.map((v) => String(v))
        : value
          ? [String(value)]
          : []
      return { multi_select: arr.filter(Boolean).map((v) => ({ name: clampOption(v) })) }
    }
    case "date": {
      const s = value ? String(value) : ""
      return { date: s ? { start: s } : null }
    }
    case "files": {
      const files = answerFiles(value) ?? []
      return {
        files: files
          .filter((f) => f.url)
          .map((f) => ({ name: clampOption(f.name), external: { url: f.url } })),
      }
    }
    default:
      return { rich_text: [{ text: { content: clampText(answerToCell(value)) } }] }
  }
}

/**
 * Best-effort: deliver one submission to Notion under the GLOBAL model. The
 * workspace Notion connection is the on-switch; a form's database is created
 * LAZILY on its first response and reconciled on every sync so new questions
 * appear as properties. Called AFTER commit; must never throw into the submit
 * path — a Notion outage can't block a respondent.
 */
export async function syncSubmissionToNotion(
  form: { id: string; workspaceId: string; title: string },
  answers: { fieldId: string; value: AnswerValue }[],
  submissionId: string,
): Promise<void> {
  try {
    const conn = await notionConnection(form.workspaceId)
    if (!conn) return

    const row = await notionIntegration(form.id)
    if (row && !row.enabled) return // explicitly paused for this form

    let config = row?.config as NotionIntegrationConfig | undefined

    if (!config) {
      // First response since the workspace connected — provision now and store it.
      config = await createFormDatabase(conn, form.id, form.title)
      await db.insert(formIntegrations).values({
        formId: form.id,
        workspaceId: form.workspaceId,
        type: "notion",
        enabled: true,
        config,
      })
      // The database is brand-new. Write EVERY completed response (this one
      // included, as it is already committed) so connecting Notion after
      // responses exist brings the history across — not just pages from now on.
      // Returning here matters: falling through would write this submission a
      // second time.
      await backfillFormNotionDatabase(conn, config, form.id)
      return
    }

    // Grow properties for any newly added fields.
    const reconciled = await reconcileFormDatabase(conn, config, form.id)
    config = reconciled.config
    if (reconciled.changed && row) {
      await db
        .update(formIntegrations)
        .set({ config })
        .where(eq(formIntegrations.id, row.id))
    }

    const token = decrypt(conn.accessToken)
    const answerByField = new Map(answers.map((a) => [a.fieldId, a.value]))
    const properties: Record<string, unknown> = {
      [config.titlePropertyName]: { title: [{ text: { content: submissionId } }] },
    }
    for (const p of config.properties) {
      properties[p.name] = toNotionValue(p.type, answerByField.get(p.fieldId))
    }

    await createDatabasePage(token, config.databaseId, properties)
  } catch (err) {
    console.error("[notion] submission delivery failed", err)
  }
}

/**
 * Bulk-deliver every completed submission a form already has into its Notion
 * database. Runs whenever Notion becomes the destination for a form that already
 * had responses — on connect, on publish, on un-pause — so the database shows the
 * full history rather than only what arrives from then on.
 *
 * Idempotent: submission ids already present in the title property are skipped,
 * so re-running (e.g. to pick up what a cap cut short) never duplicates a page.
 *
 * Deliberately unlike the Sheets backfill in two ways, both forced by the API:
 * pages are created one request at a time rather than in a single append, and
 * the run is paced and capped. Returns how many pages it wrote; never throws
 * into the caller.
 */
export async function backfillFormNotionDatabase(
  conn: WorkspaceConnection,
  config: NotionIntegrationConfig,
  formId: string,
  limit = MAX_FORM_BACKFILL,
): Promise<number> {
  try {
    if (!config.databaseId || limit <= 0) return 0
    const token = decrypt(conn.accessToken)

    // One paged scan of what's already there, rather than a lookup per row.
    const present = await listDatabaseTitles(token, config.databaseId, config.titlePropertyName)

    const subs = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.formId, formId), eq(submissions.status, "completed")))
      .orderBy(submissions.createdAt)

    const missing = subs.filter((sub) => !present.has(sub.id))
    if (missing.length === 0) return 0

    // Oldest first, so a capped run leaves a contiguous gap at the recent end
    // that the next run fills — rather than holes scattered through the history.
    const pending = missing.slice(0, limit)
    if (missing.length > pending.length) {
      console.warn(
        `[notion] backfill capped at ${pending.length} of ${missing.length} responses for form ${formId}; re-run to continue`,
      )
    }

    // All answers for the pending submissions in one query, indexed by
    // submission → field. AI follow-ups (null fieldId) have no property, so skip.
    const answerRows = await db
      .select({
        submissionId: answers.submissionId,
        fieldId: answers.fieldId,
        value: answers.value,
      })
      .from(answers)
      .where(inArray(answers.submissionId, pending.map((sub) => sub.id)))

    const bySubmission = new Map<string, Map<string, AnswerValue>>()
    for (const a of answerRows) {
      if (!a.fieldId) continue
      let fields = bySubmission.get(a.submissionId)
      if (!fields) bySubmission.set(a.submissionId, (fields = new Map()))
      fields.set(a.fieldId, a.value)
    }

    let written = 0
    let consecutiveFailures = 0
    for (const [i, sub] of pending.entries()) {
      const byField = bySubmission.get(sub.id) ?? new Map<string, AnswerValue>()
      const properties: Record<string, unknown> = {
        [config.titlePropertyName]: { title: [{ text: { content: sub.id } }] },
      }
      for (const prop of config.properties) {
        properties[prop.name] = toNotionValue(prop.type, byField.get(prop.fieldId))
      }

      try {
        await createDatabasePage(token, config.databaseId, properties)
        written += 1
        consecutiveFailures = 0
      } catch (err) {
        // One malformed answer shouldn't cost the whole history, but a token
        // that's been revoked (or a rate limit we're not respecting) fails every
        // page — stop rather than grind through hundreds of certain failures.
        consecutiveFailures += 1
        console.error(`[notion] backfill page failed for submission ${sub.id}`, err)
        if (consecutiveFailures >= BACKFILL_ABORT_AFTER) {
          console.error("[notion] backfill aborted after repeated failures")
          break
        }
      }

      if (i < pending.length - 1) await wait(BACKFILL_INTERVAL_MS)
    }

    return written
  } catch (err) {
    console.error("[notion] backfill failed", err)
    return 0
  }
}

/**
 * Eagerly create a form's Notion database so it exists BEFORE any response
 * arrives — the mirror of `ensureFormSheet`. Under the global model the
 * database is otherwise provisioned lazily on the first submission, which left
 * a live form with nothing to point downstream tooling at, and left a failed
 * provisioning attempt indistinguishable from "no responses yet".
 *
 * No-op when the workspace hasn't connected Notion, or when the form already
 * has a Notion row (provisioned, or explicitly paused — never override the
 * user's choice). Best-effort: never throws, so it's safe to call off the
 * response path.
 *
 * Returns how many historical pages the backfill wrote, so a caller provisioning
 * several forms can spend one shared budget across them.
 */
export async function ensureFormNotionDatabase(
  form: { id: string; workspaceId: string; title: string },
  backfillLimit = MAX_FORM_BACKFILL,
): Promise<number> {
  try {
    const conn = await notionConnection(form.workspaceId)
    if (!conn) return 0 // Notion not connected for this workspace — nothing to do.

    const row = await notionIntegration(form.id)
    if (row) return 0 // already has a database (or is paused) — leave it as-is.

    const config = await createFormDatabase(conn, form.id, form.title)
    await db.insert(formIntegrations).values({
      formId: form.id,
      workspaceId: form.workspaceId,
      type: "notion",
      enabled: true,
      config,
    })
    // Provisioning eagerly used to PRE-EMPT the lazy path above, which was the
    // only thing that ever moved existing responses across: the database was
    // created empty and the next submission appended a single page. Backfill
    // here so eager and lazy provisioning agree on what a new database holds.
    return await backfillFormNotionDatabase(conn, config, form.id, backfillLimit)
  } catch (err) {
    console.error("[notion] eager database provisioning failed", err)
    return 0
  }
}


/**
 * Provision databases for every already-published form in a workspace — run once,
 * just after Notion is connected.
 *
 * Connecting is the moment the user expects their forms to have somewhere to
 * land. Without this, a workspace that connects AFTER publishing its forms sees
 * every one of them sitting at "not created yet" until a response happens to
 * arrive.
 *
 * Serial and capped: Notion rate-limits, and each form costs several API
 * calls. Forms beyond the cap are provisioned on publish or on first response
 * as before. Best-effort — never throws into the OAuth callback.
 *
 * Each form also brings its existing responses across, drawn from one shared
 * page budget — see MAX_CONNECT_BACKFILL for why that isn't per-form.
 */
export async function ensureWorkspaceNotionDatabases(workspaceId: string): Promise<void> {
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

    // Shared across the sweep: a form that exhausts the budget still gets its
    // database (limit 0 skips only the backfill), so nothing is left without a
    // destination — the owner can pull the rest in from the form's toggle.
    let budget = MAX_CONNECT_BACKFILL
    for (const f of rows) {
      const written = await ensureFormNotionDatabase(
        { id: f.id, workspaceId, title: f.title },
        budget,
      )
      budget -= written
      if (budget <= 0) {
        console.warn(
          `[notion] backfill budget of ${MAX_CONNECT_BACKFILL} pages spent; remaining forms provisioned empty`,
        )
        budget = 0
      }
    }
  } catch (err) {
    console.error("[notion] workspace provisioning failed", err)
  }
}

/**
 * Best-effort: archive a submission's Notion page (called when the owner deletes
 * the submission). Finds the page by the submission id in the title property.
 * No-op for paused forms or disconnected workspaces. Never throws.
 */
export async function deleteSubmissionFromNotion(
  form: { id: string; workspaceId: string },
  submissionId: string,
): Promise<void> {
  try {
    const conn = await notionConnection(form.workspaceId)
    if (!conn) return

    const row = await notionIntegration(form.id)
    if (!row || !row.enabled) return
    const config = row.config as NotionIntegrationConfig
    if (!config?.databaseId) return

    const token = decrypt(conn.accessToken)
    const pageId = await queryDatabaseByTitle(
      token,
      config.databaseId,
      config.titlePropertyName,
      submissionId,
    )
    if (!pageId) return // already gone, or never synced
    await archivePage(token, pageId)
  } catch (err) {
    console.error("[notion] page archival failed", err)
  }
}
