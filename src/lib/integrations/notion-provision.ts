import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  formFields,
  workspaceConnections,
  type NotionIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import { decrypt } from "@/lib/integrations/crypto"
import {
  createDatabase,
  createPage,
  findAccessiblePage,
  updateDatabaseProperties,
} from "@/lib/integrations/notion"

/**
 * Notion database provisioning, reused by the lazy sync on first submission and
 * by any future enable action. A form maps to one Notion database; each form
 * field becomes a typed property. One owned `title` property ("Submission") is
 * always present, set to the submission id so a page can be found + archived.
 *
 * Property names are frozen once created (the property name is its identity in
 * Notion). New fields append new properties; removed fields keep theirs so old
 * pages still resolve — the append-only contract mirrors the Sheets columns.
 */

const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])

export const TITLE_PROP = "Submission"

type Field = { fieldId: string; label: string; type: string }

/** Answerable fields of a form, in display order. */
export async function answerableFields(formId: string): Promise<Field[]> {
  const fields = await db
    .select({ id: formFields.id, label: formFields.label, type: formFields.type })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  return fields
    .filter((f) => !NON_ANSWER.has(f.type))
    .map((f, i) => ({ fieldId: f.id, label: f.label || `Question ${i + 1}`, type: f.type }))
}

/** Map a form field type to a Notion property type. */
export function notionTypeFor(fieldType: string): string {
  switch (fieldType) {
    case "email":
      return "email"
    case "phone":
      return "phone_number"
    case "url":
      return "url"
    case "multiple_choice":
    case "dropdown":
    case "yes_no":
      return "select"
    case "multi_select":
    case "checkboxes":
    case "ranking":
      return "multi_select"
    case "rating":
    case "scale":
    case "nps":
      return "number"
    case "date":
      return "date"
    case "file_upload":
      return "files"
    default:
      // short_text, long_text, address, signature, hidden, time, …
      return "rich_text"
  }
}

/** The empty Notion schema object for a property type, e.g. `{ email: {} }`. */
function schemaForType(notionType: string): Record<string, unknown> {
  return { [notionType]: {} }
}

/** Assign a unique property name (Notion names must not collide). */
function uniqueName(base: string, used: Set<string>): string {
  let name = base.trim() || "Field"
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  let n = 2
  while (used.has(`${name} (${n})`)) n += 1
  name = `${name} (${n})`
  used.add(name)
  return name
}

type Property = { fieldId: string; name: string; type: string }

/** Build the frozen property list for a set of fields (title reserved first). */
function buildProperties(fields: Field[]): Property[] {
  const used = new Set<string>([TITLE_PROP])
  return fields.map((f) => ({
    fieldId: f.fieldId,
    name: uniqueName(f.label, used),
    type: notionTypeFor(f.type),
  }))
}

/** The Notion database `properties` schema object from a property list. */
function schemaFromProperties(properties: Property[]): Record<string, unknown> {
  const schema: Record<string, unknown> = { [TITLE_PROP]: { title: {} } }
  for (const p of properties) schema[p.name] = schemaForType(p.type)
  return schema
}

/**
 * The workspace's "MakingFlow Submissions" parent page (one per workspace),
 * created under a consent-granted page on first use and cached on the
 * connection's metadata. Throws if the integration can't access any page.
 */
export async function ensureParentPage(conn: WorkspaceConnection): Promise<string> {
  const existing = conn.metadata?.notion?.parentPageId
  if (existing) return existing

  const token = decrypt(conn.accessToken)
  const accessible = await findAccessiblePage(token)
  if (!accessible) {
    throw new Error("Notion integration has no accessible page to create the parent under")
  }
  const page = await createPage(token, accessible, "MakingFlow Submissions")

  const metadata = {
    ...(conn.metadata ?? {}),
    notion: { ...(conn.metadata?.notion ?? {}), parentPageId: page.id },
  }
  await db
    .update(workspaceConnections)
    .set({ metadata })
    .where(eq(workspaceConnections.id, conn.id))

  return page.id
}

/** Create a fresh Notion database for a form and return its config. */
export async function createFormDatabase(
  conn: WorkspaceConnection,
  formId: string,
  formTitle: string,
): Promise<NotionIntegrationConfig> {
  const token = decrypt(conn.accessToken)
  const parentPageId = await ensureParentPage(conn)
  const properties = buildProperties(await answerableFields(formId))
  const { id, url } = await createDatabase(
    token,
    parentPageId,
    `MakingFlow – ${formTitle || "Untitled form"}`,
    schemaFromProperties(properties),
  )
  return {
    databaseId: id,
    databaseUrl: url,
    titlePropertyName: TITLE_PROP,
    properties,
  }
}

/**
 * Grow an existing database to cover any newly added fields (append-only).
 * Existing properties keep their frozen names; removed fields keep theirs.
 * Returns the updated config plus whether anything changed.
 */
export async function reconcileFormDatabase(
  conn: WorkspaceConnection,
  config: NotionIntegrationConfig,
  formId: string,
): Promise<{ config: NotionIntegrationConfig; changed: boolean }> {
  const current = await answerableFields(formId)
  const known = new Set(config.properties.map((p) => p.fieldId))
  const fresh = current.filter((f) => !known.has(f.fieldId))
  if (fresh.length === 0) return { config, changed: false }

  const used = new Set<string>([TITLE_PROP, ...config.properties.map((p) => p.name)])
  const added: Property[] = fresh.map((f) => ({
    fieldId: f.fieldId,
    name: uniqueName(f.label, used),
    type: notionTypeFor(f.type),
  }))

  const patch: Record<string, unknown> = {}
  for (const p of added) patch[p.name] = schemaForType(p.type)

  const token = decrypt(conn.accessToken)
  await updateDatabaseProperties(token, config.databaseId, patch)

  return {
    config: { ...config, properties: [...config.properties, ...added] },
    changed: true,
  }
}
