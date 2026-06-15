import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formIntegrations,
  workspaceConnections,
  type AnswerValue,
  type NotionIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import { decrypt } from "@/lib/integrations/crypto"
import { archivePage, createDatabasePage, queryDatabaseByTitle } from "@/lib/integrations/notion"
import { createFormDatabase, reconcileFormDatabase } from "@/lib/integrations/notion-provision"
import { answerFiles, answerToCell } from "@/lib/submissions/answer-format"

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
      config = await createFormDatabase(conn, form.id, form.title)
      await db.insert(formIntegrations).values({
        formId: form.id,
        workspaceId: form.workspaceId,
        type: "notion",
        enabled: true,
        config,
      })
    } else {
      const reconciled = await reconcileFormDatabase(conn, config, form.id)
      config = reconciled.config
      if (reconciled.changed && row) {
        await db
          .update(formIntegrations)
          .set({ config })
          .where(eq(formIntegrations.id, row.id))
      }
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
