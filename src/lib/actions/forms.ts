"use server"

import { and, eq, isNull, notInArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { forms, formFields, type FormSettings, type FormAiConfig, type FormTheme } from "@/lib/db/schema"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import type { EditorForm } from "@/lib/builder/form-model"

type SaveResult = { success: true; id: string } | { success: false; error: string }

/** Short, unguessable id for the public runtime URL (/f/[publicId]). */
function newPublicId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
}

/**
 * Persist an AI-built form to `forms` + `form_fields`, scoped to the caller's
 * workspace. Creates on first save (no formId), updates thereafter. Powers both
 * the manual Save button and debounced draft autosave in the builder.
 */
export async function saveAiForm(input: {
  formId?: string | null
  form: EditorForm
}): Promise<SaveResult> {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const title = input.form.title?.trim() || "Untitled form"
  const fields = input.form.fields ?? []

  // Verify ownership before updating an existing form.
  let formId = input.formId ?? null
  if (formId) {
    const [existing] = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
      .limit(1)
    if (!existing) return { success: false, error: "Form not found" }
  }

  try {
    await db.transaction(async (tx) => {
      if (!formId) {
        const [created] = await tx
          .insert(forms)
          .values({
            workspaceId: workspace.id,
            createdById: user.id,
            title,
            publicId: newPublicId(),
          })
          .returning({ id: forms.id })
        formId = created.id
      } else {
        await tx.update(forms).set({ title }).where(eq(forms.id, formId))
      }
      const fid = formId as string

      // Upsert fields keyed on their stable id. Unlike delete-and-reinsert, this
      // keeps each row in place — so `answers.fieldId` references (ON DELETE SET
      // NULL) survive an edit of a form that already has submissions.
      if (fields.length > 0) {
        await tx
          .insert(formFields)
          .values(
            fields.map((f, i) => ({
              id: f.id,
              formId: fid,
              type: f.type,
              label: f.label ?? "",
              description: f.description ?? null,
              placeholder: f.placeholder ?? null,
              required: f.required ?? false,
              position: i,
              options: f.options && f.options.length > 0 ? f.options : null,
              config: f.config ?? null,
              logic: f.logic ?? null,
            })),
          )
          .onConflictDoUpdate({
            target: formFields.id,
            set: {
              type: sql`excluded.type`,
              label: sql`excluded.label`,
              description: sql`excluded.description`,
              placeholder: sql`excluded.placeholder`,
              required: sql`excluded.required`,
              position: sql`excluded.position`,
              options: sql`excluded.options`,
              config: sql`excluded.config`,
              logic: sql`excluded.logic`,
              deletedAt: null, // restore if a previously-removed id reappears
              updatedAt: new Date(),
            },
          })
      }

      // Soft-delete fields the editor removed — keeps their row (and any answers
      // pointing at it) instead of hard-deleting and orphaning submissions.
      const keepIds = fields.map((f) => f.id)
      await tx
        .update(formFields)
        .set({ deletedAt: new Date() })
        .where(
          keepIds.length > 0
            ? and(
                eq(formFields.formId, fid),
                isNull(formFields.deletedAt),
                notInArray(formFields.id, keepIds),
              )
            : and(eq(formFields.formId, fid), isNull(formFields.deletedAt)),
        )
    })
  } catch (err) {
    console.error("[saveAiForm] failed", err)
    return { success: false, error: "Could not save the form" }
  }

  return { success: true, id: formId as string }
}

type PublishResult =
  | { success: true; publicId: string }
  | { success: false; error: string }

/** Make a form live at /f/[publicId]. Workspace-scoped. */
export async function publishForm(formId: string): Promise<PublishResult> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .select({ id: forms.id, publicId: forms.publicId })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!row) return { success: false, error: "Form not found" }

  await db
    .update(forms)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(forms.id, formId))

  return { success: true, publicId: row.publicId }
}

/** Take a form offline (back to draft). Workspace-scoped. */
export async function unpublishForm(
  formId: string,
): Promise<{ success: boolean; error?: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const result = await db
    .update(forms)
    .set({ status: "draft" })
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .returning({ id: forms.id })

  if (result.length === 0) return { success: false, error: "Form not found" }
  return { success: true }
}

/** Soft-delete a form (and hide it everywhere). Workspace-scoped. */
export async function deleteForm(
  formId: string,
): Promise<{ success: boolean; error?: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const result = await db
    .update(forms)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(forms.id, formId),
        eq(forms.workspaceId, workspace.id),
        isNull(forms.deletedAt),
      ),
    )
    .returning({ id: forms.id })

  if (result.length === 0) return { success: false, error: "Form not found" }
  revalidatePath("/forms")
  return { success: true }
}

export type FormSettingsPatch = {
  closed?: boolean
  submissionLimit?: number | null
  closesAt?: string | null // ISO string, or null to clear
  redirectUrl?: string | null
  oneResponsePerPerson?: boolean
  showProgressBar?: boolean
  submitButtonLabel?: string | null
  thankYouMessage?: string | null
  // Response experience (classic vs conversational chat).
  renderMode?: "classic" | "conversational"
  persona?: string | null
  followUpsEnabled?: boolean
  clarifyVagueAnswers?: boolean
  // Branding (logo + banner) — null clears the asset.
  logoUrl?: string | null
  coverImageUrl?: string | null
}

/**
 * Update a form's response-collection settings from the Settings tab. The
 * submission-control columns are enforced server-side on every submit; the
 * jsonb `settings` holds presentation knobs. Workspace-scoped.
 */
export async function updateFormSettings(
  formId: string,
  patch: FormSettingsPatch,
): Promise<{ success: boolean; error?: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .select({
      status: forms.status,
      settings: forms.settings,
      aiConfig: forms.aiConfig,
      theme: forms.theme,
    })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!row) return { success: false, error: "Form not found" }

  const set: Record<string, unknown> = {}

  // "Close form" only toggles between published and closed — never touches a
  // draft (which still needs a real publish to go live).
  if (patch.closed !== undefined) {
    if (patch.closed) {
      if (row.status === "published") set.status = "closed"
    } else if (row.status === "closed") {
      set.status = "published"
    }
  }
  if (patch.submissionLimit !== undefined) set.submissionLimit = patch.submissionLimit
  if (patch.closesAt !== undefined)
    set.closesAt = patch.closesAt ? new Date(patch.closesAt) : null
  if (patch.redirectUrl !== undefined)
    set.redirectUrl = patch.redirectUrl?.trim() || null
  if (patch.oneResponsePerPerson !== undefined)
    set.oneResponsePerPerson = patch.oneResponsePerPerson

  if (
    patch.showProgressBar !== undefined ||
    patch.submitButtonLabel !== undefined ||
    patch.thankYouMessage !== undefined
  ) {
    const settings: FormSettings = { ...(row.settings ?? {}) }
    if (patch.showProgressBar !== undefined) settings.showProgressBar = patch.showProgressBar
    if (patch.submitButtonLabel !== undefined)
      settings.submitButtonLabel = patch.submitButtonLabel?.trim() || undefined
    if (patch.thankYouMessage !== undefined)
      settings.thankYouMessage = patch.thankYouMessage?.trim() || undefined
    set.settings = settings
  }

  // Response experience: conversational mode requires AI, so switching to it
  // turns AI on. Persona/follow-up/clarify knobs merge into the aiConfig jsonb.
  if (patch.renderMode !== undefined) {
    set.renderMode = patch.renderMode
    if (patch.renderMode === "conversational") set.aiEnabled = true
  }
  if (
    patch.persona !== undefined ||
    patch.followUpsEnabled !== undefined ||
    patch.clarifyVagueAnswers !== undefined
  ) {
    const aiConfig: FormAiConfig = { ...(row.aiConfig ?? {}) }
    if (patch.persona !== undefined) aiConfig.persona = patch.persona?.trim() || undefined
    if (patch.followUpsEnabled !== undefined) aiConfig.followUpsEnabled = patch.followUpsEnabled
    if (patch.clarifyVagueAnswers !== undefined)
      aiConfig.clarifyVagueAnswers = patch.clarifyVagueAnswers
    set.aiConfig = aiConfig
  }

  // Branding (logo + banner) merges into the theme jsonb.
  if (patch.logoUrl !== undefined || patch.coverImageUrl !== undefined) {
    const theme: FormTheme = { ...(row.theme ?? {}) }
    if (patch.logoUrl !== undefined) theme.logoUrl = patch.logoUrl?.trim() || undefined
    if (patch.coverImageUrl !== undefined)
      theme.coverImageUrl = patch.coverImageUrl?.trim() || undefined
    set.theme = theme
  }

  if (Object.keys(set).length === 0) return { success: true }

  await db.update(forms).set(set).where(eq(forms.id, formId))
  revalidatePath(`/forms/${formId}`, "layout")
  return { success: true }
}
