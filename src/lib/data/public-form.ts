import { and, eq, isNull, sql } from "drizzle-orm"
import { cacheLife, cacheTag } from "next/cache"
import { db } from "@/lib/db"
import {
  forms,
  formFields,
  submissions,
  customDomains,
  type FieldLogic,
  type FieldConfig,
} from "@/lib/db/schema"

export type PublicOption = { id: string; label: string }

export type PublicField = {
  id: string
  type: string
  label: string
  description?: string
  placeholder?: string
  required: boolean
  options?: PublicOption[]
  logic?: FieldLogic
  config?: FieldConfig
}

/** Respondent-safe AI config for the conversational runtime. Deliberately omits
 *  owner-only knobs (screeningCriteria, summaryEnabled) — never sent to the public. */
export type PublicAiConfig = {
  enabled: boolean
  followUpsEnabled: boolean
  clarifyVagueAnswers: boolean
  persona: string | null
}

/** Respondent-safe branding (logo + banner) for the public runtime header. */
export type PublicTheme = {
  logoUrl?: string
  coverImageUrl?: string
}

export type PublicForm = {
  publicId: string
  title: string
  submitLabel: string
  thankYou: string
  /** Success-page body (markdown) + optional uploaded video, shown after submit. */
  successBody: string | null
  successVideoUrl: string | null
  redirectUrl: string | null
  showProgressBar: boolean
  /** How the form is presented to respondents. */
  renderMode: "classic" | "conversational"
  /** The form's authoring language; conversational answers normalize back to it. */
  baseLanguage: string
  /** Present only when the form has AI enabled; null otherwise. */
  ai: PublicAiConfig | null
  /** Logo + banner, when the builder set either; null otherwise. */
  theme: PublicTheme | null
  fields: PublicField[]
}

export type PublicFormResult =
  | { state: "ok"; form: PublicForm }
  | { state: "missing" }
  | { state: "unavailable" }

type FormRow = typeof forms.$inferSelect
type FormFieldRow = typeof formFields.$inferSelect
export type FormDef = { row: FormRow; fields: PublicField[] }

function mapFields(raw: FormFieldRow[]): PublicField[] {
  return raw.map((f) => ({
    id: f.id,
    type: f.type,
    label: f.label,
    description: f.description ?? undefined,
    placeholder: f.placeholder ?? undefined,
    required: f.required,
    options: f.options ?? undefined,
    logic: f.logic ?? undefined,
    config: f.config ?? undefined,
  }))
}

function mapForm(row: FormRow, fields: PublicField[]): PublicForm {
  return {
    publicId: row.publicId,
    title: row.title,
    submitLabel: row.settings?.submitButtonLabel || "Submit",
    thankYou: row.settings?.thankYouMessage || "Thanks! Your response has been recorded.",
    successBody: row.settings?.successBody || null,
    successVideoUrl: row.settings?.successVideoUrl || null,
    redirectUrl: row.redirectUrl ?? null,
    showProgressBar: row.settings?.showProgressBar ?? false,
    renderMode: row.renderMode,
    baseLanguage: row.baseLanguage,
    ai: row.aiEnabled
      ? {
          enabled: true,
          followUpsEnabled: row.aiConfig?.followUpsEnabled ?? false,
          clarifyVagueAnswers: row.aiConfig?.clarifyVagueAnswers ?? false,
          persona: row.aiConfig?.persona ?? null,
        }
      : null,
    theme:
      row.theme && (row.theme.logoUrl || row.theme.coverImageUrl)
        ? { logoUrl: row.theme.logoUrl, coverImageUrl: row.theme.coverImageUrl }
        : null,
    fields,
  }
}

/**
 * Dynamic gating — runs every request (never cached). Enforces PUBLISHED +
 * in-window + under-limit using the current time and a LIVE submission count.
 * Kept out of the cache precisely because it's time/count dependent.
 */
async function gate(def: FormDef): Promise<PublicFormResult> {
  const { row, fields } = def
  const now = new Date()
  if (row.status !== "published") return { state: "unavailable" }
  if (row.opensAt && row.opensAt > now) return { state: "unavailable" }
  if (row.closesAt && row.closesAt < now) return { state: "unavailable" }
  if (row.submissionLimit != null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(eq(submissions.formId, row.id), eq(submissions.status, "completed")))
    if (count >= row.submissionLimit) return { state: "unavailable" }
  }
  return { state: "ok", form: mapForm(row, fields) }
}

async function loadFields(formId: string): Promise<PublicField[]> {
  const raw = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  return mapFields(raw)
}

/**
 * Cached form DEFINITION (row + fields) by public id. Changes only when the
 * builder edits/publishes the form — invalidated by `updateTag(form-${id})` in
 * the form actions. The time-window / submission-limit gating stays OUT of the
 * cache (see `gate`).
 */
export async function loadFormDef(publicId: string): Promise<FormDef | null> {
  "use cache"
  cacheLife("minutes")
  cacheTag(`form-public-${publicId}`)
  const [row] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.publicId, publicId), isNull(forms.deletedAt)))
    .limit(1)
  if (!row) return null
  cacheTag(`form-${row.id}`)
  return { row, fields: await loadFields(row.id) }
}

async function loadFormDefByDomain(host: string, slug: string): Promise<FormDef | null> {
  "use cache"
  cacheLife("minutes")
  cacheTag(`form-domain-${host.toLowerCase()}-${slug}`)
  const [domainRow] = await db
    .select({ id: customDomains.id })
    .from(customDomains)
    .where(and(eq(customDomains.domain, host.toLowerCase()), eq(customDomains.status, "active")))
    .limit(1)
  if (!domainRow) return null
  const [row] = await db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.customDomainId, domainRow.id),
        eq(forms.slug, slug),
        isNull(forms.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null
  cacheTag(`form-${row.id}`)
  return { row, fields: await loadFields(row.id) }
}

/**
 * Load a published form for the public runtime (/f/[publicId]). No auth, no
 * workspace scoping — but only PUBLISHED, in-window, under-limit forms resolve.
 */
export async function getPublicForm(publicId: string): Promise<PublicFormResult> {
  try {
    const def = await loadFormDef(publicId)
    if (!def) return { state: "missing" }
    return await gate(def)
  } catch (err) {
    // A transient DB error shouldn't crash the public page — degrade to the
    // "unavailable" screen and log the real cause for diagnosis.
    console.error("[getPublicForm] query failed", err)
    return { state: "unavailable" }
  }
}

/**
 * Resolve a form from a custom domain + slug, e.g. team.acme.com/feedback.
 * The domain must be ACTIVE and the form must live on it under that slug.
 */
export async function getPublicFormByDomain(
  host: string,
  slug: string,
): Promise<PublicFormResult> {
  try {
    const def = await loadFormDefByDomain(host, slug)
    if (!def) return { state: "missing" }
    return await gate(def)
  } catch (err) {
    console.error("[getPublicFormByDomain] query failed", err)
    return { state: "unavailable" }
  }
}
