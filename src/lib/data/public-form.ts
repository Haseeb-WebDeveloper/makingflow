import { and, eq, isNull, sql } from "drizzle-orm"
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

export type PublicForm = {
  publicId: string
  title: string
  submitLabel: string
  thankYou: string
  redirectUrl: string | null
  showProgressBar: boolean
  fields: PublicField[]
}

export type PublicFormResult =
  | { state: "ok"; form: PublicForm }
  | { state: "missing" }
  | { state: "unavailable" }

type FormRow = typeof forms.$inferSelect

/**
 * Shared resolution for an already-loaded form row: enforce PUBLISHED + in-window
 * + under-limit, then map to the runtime shape. Used by both the /f/[publicId]
 * route and the custom-domain route so they behave identically.
 */
async function resolvePublishedForm(row: FormRow): Promise<PublicFormResult> {
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

  const fields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, row.id), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)

  return {
    state: "ok",
    form: {
      publicId: row.publicId,
      title: row.title,
      submitLabel: row.settings?.submitButtonLabel || "Submit",
      thankYou: row.settings?.thankYouMessage || "Thanks! Your response has been recorded.",
      redirectUrl: row.redirectUrl ?? null,
      showProgressBar: row.settings?.showProgressBar ?? false,
      fields: fields.map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        description: f.description ?? undefined,
        placeholder: f.placeholder ?? undefined,
        required: f.required,
        options: f.options ?? undefined,
        logic: f.logic ?? undefined,
        config: f.config ?? undefined,
      })),
    },
  }
}

/**
 * Load a published form for the public runtime (/f/[publicId]). No auth, no
 * workspace scoping — but only PUBLISHED, in-window, under-limit forms resolve.
 */
export async function getPublicForm(publicId: string): Promise<PublicFormResult> {
  try {
    const [row] = await db
      .select()
      .from(forms)
      .where(and(eq(forms.publicId, publicId), isNull(forms.deletedAt)))
      .limit(1)
    if (!row) return { state: "missing" }
    return await resolvePublishedForm(row)
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
    const [domainRow] = await db
      .select({ id: customDomains.id })
      .from(customDomains)
      .where(
        and(eq(customDomains.domain, host.toLowerCase()), eq(customDomains.status, "active")),
      )
      .limit(1)
    if (!domainRow) return { state: "missing" }

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
    if (!row) return { state: "missing" }
    return await resolvePublishedForm(row)
  } catch (err) {
    console.error("[getPublicFormByDomain] query failed", err)
    return { state: "unavailable" }
  }
}
