"use server"

import { after } from "next/server"
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { db } from "@/lib/db"
import { forms, formFields, uploads, type FormSettings, type FormAiConfig, type FormTheme, type FieldConfig, type FieldLogic } from "@/lib/db/schema"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import { destroyAssets, assetFromUrl, resourceTypeFromMime, type CloudinaryAsset } from "@/lib/cloudinary/delete"
import { type EditorForm, DEFAULT_FORM_TITLE } from "@/lib/builder/form-model"

type SaveResult = { success: true; id: string } | { success: false; error: string }

/** Rewrite a field's logic conditions onto duplicated field ids (old → new). */
function remapLogic(
  logic: FieldLogic | null,
  idMap: Map<string, string>,
): FieldLogic | null {
  if (!logic) return logic
  return {
    ...logic,
    conditions: logic.conditions.map((c) => ({
      ...c,
      fieldId: idMap.get(c.fieldId) ?? c.fieldId,
    })),
  }
}

/** Short, unguessable id for the public runtime URL (/f/[publicId]). */
function newPublicId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
}

/**
 * Create an empty draft form and return its id, so "New form" can navigate
 * straight to /forms/[id]/edit (create-then-edit) instead of building first and
 * redirecting after. Deliberately does NOT invalidate `workspace-forms` — a
 * blank draft stays out of the dashboard/sidebar list until it gets real content
 * (`saveAiForm` invalidates then). Abandoned empties are removed by the
 * delete-draft endpoint when the user leaves the editor.
 */
export async function createDraftForm(): Promise<{ id: string }> {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) throw new Error("No workspace")
  const [created] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      createdById: user.id,
      title: DEFAULT_FORM_TITLE,
      publicId: newPublicId(),
    })
    .returning({ id: forms.id })
  return { id: created.id }
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

  const title = input.form.title?.trim() || DEFAULT_FORM_TITLE
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

  // Field/title edits change the public form definition — drop its cache.
  updateTag(`form-${formId as string}`)
  updateTag(`workspace-forms-${workspace.id}`) // list shows title/status
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

  updateTag(`form-${formId}`)
  updateTag(`workspace-forms-${workspace.id}`)
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
  updateTag(`form-${formId}`)
  updateTag(`workspace-forms-${workspace.id}`)
  return { success: true }
}

/** Rename a form. Workspace-scoped; empty titles fall back to "Untitled form". */
export async function renameForm(
  formId: string,
  title: string,
): Promise<{ success: boolean; error?: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const clean = title.trim().slice(0, 200) || "Untitled form"
  const result = await db
    .update(forms)
    .set({ title: clean })
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .returning({ id: forms.id })

  if (result.length === 0) return { success: false, error: "Form not found" }
  updateTag(`form-${formId}`) // title shows on the public form
  updateTag(`workspace-forms-${workspace.id}`)
  revalidatePath("/forms")
  revalidatePath(`/forms/${formId}`, "layout")
  return { success: true }
}

/**
 * Duplicate a form (definition + fields) as a fresh draft. The copy gets a new
 * publicId, no custom domain/slug, and draft status — so it never collides with
 * the original's public link or steals its submissions. Workspace-scoped.
 */
export async function duplicateForm(
  formId: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [src] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!src) return { success: false, error: "Form not found" }

  const srcFields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)

  try {
    const newId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(forms)
        .values({
          workspaceId: workspace.id,
          createdById: user.id,
          title: `${src.title || "Untitled form"} (copy)`,
          publicId: newPublicId(),
          // Fresh draft — never inherit the original's live link or domain.
          status: "draft",
          customDomainId: null,
          slug: null,
          publishedAt: null,
          // Carry over the form's design + behavior so the copy is a true clone.
          renderMode: src.renderMode,
          baseLanguage: src.baseLanguage,
          autoTranslate: src.autoTranslate,
          aiEnabled: src.aiEnabled,
          aiConfig: src.aiConfig,
          theme: src.theme,
          settings: src.settings,
          opensAt: src.opensAt,
          closesAt: src.closesAt,
          submissionLimit: src.submissionLimit,
          oneResponsePerPerson: src.oneResponsePerPerson,
          redirectUrl: src.redirectUrl,
        })
        .returning({ id: forms.id })

      if (srcFields.length > 0) {
        // New rows need new ids; remap conditional-logic references so the copy's
        // logic points at the copy's fields, not the original's.
        const idMap = new Map<string, string>()
        for (const f of srcFields) idMap.set(f.id, crypto.randomUUID())

        await tx.insert(formFields).values(
          srcFields.map((f, i) => ({
            id: idMap.get(f.id)!,
            formId: created.id,
            type: f.type,
            label: f.label,
            description: f.description,
            placeholder: f.placeholder,
            required: f.required,
            position: i,
            key: f.key,
            options: f.options,
            config: f.config,
            logic: remapLogic(f.logic, idMap),
          })),
        )
      }
      return created.id
    })
    updateTag(`workspace-forms-${workspace.id}`)
    revalidatePath("/forms")
    return { success: true, id: newId }
  } catch (err) {
    console.error("[duplicateForm] failed", err)
    return { success: false, error: "Could not duplicate the form" }
  }
}

/** Soft-delete a form (and hide it everywhere). Workspace-scoped. */
/**
 * Permanently delete a form and everything it owns. The DB cascade removes
 * fields, submissions, answers, events, integrations and translations; we
 * additionally erase every Cloudinary asset the form touched (respondent
 * uploads + logo/cover + inline image blocks) so nothing is left in storage
 * (GDPR + storage reclaim). Hard delete by design — there is no trash/restore;
 * the confirmation dialog warns the user accordingly. Workspace-scoped.
 */
export async function deleteForm(
  formId: string,
): Promise<{ success: boolean; error?: string }> {
  await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  // Confirm ownership and grab the form's branding + success-page assets (URLs).
  const [form] = await db
    .select({ id: forms.id, theme: forms.theme, settings: forms.settings })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  // Gather Cloudinary assets to erase before the row goes away:
  //  - respondent uploads (uploads.formId is set-null on delete → would orphan)
  //  - inline image blocks (config.imageUrl) and the logo/cover (theme).
  const uploadRows = await db
    .select({ id: uploads.id, storageKey: uploads.storageKey, mimeType: uploads.mimeType })
    .from(uploads)
    .where(eq(uploads.formId, formId))

  const imageFields = await db
    .select({ config: formFields.config })
    .from(formFields)
    .where(eq(formFields.formId, formId))

  const assets: CloudinaryAsset[] = [
    ...uploadRows.map((u) => ({
      publicId: u.storageKey,
      resourceType: resourceTypeFromMime(u.mimeType),
    })),
    ...imageFields
      .map((f) => assetFromUrl((f.config as FieldConfig | null)?.imageUrl))
      .filter((a): a is CloudinaryAsset => a !== null),
    ...[form.theme?.logoUrl, form.theme?.coverImageUrl]
      .map((url) => assetFromUrl(url))
      .filter((a): a is CloudinaryAsset => a !== null),
    // Success-page media: the uploaded video + any Cloudinary images in the body.
    ...[
      form.settings?.successVideoUrl,
      ...((form.settings?.successBody ?? "").match(
        /https:\/\/res\.cloudinary\.com\/[^\s)"']+/g,
      ) ?? []),
    ]
      .map((url) => assetFromUrl(url))
      .filter((a): a is CloudinaryAsset => a !== null),
  ]

  try {
    // Cascade clears fields/submissions/answers/events/integrations/translations.
    await db.delete(forms).where(eq(forms.id, formId))
    // uploads.formId is set-null (not cascade), so remove those rows explicitly.
    if (uploadRows.length > 0) {
      await db.delete(uploads).where(inArray(uploads.id, uploadRows.map((u) => u.id)))
    }
  } catch (err) {
    console.error("[deleteForm] failed", err)
    return { success: false, error: "Couldn't delete the form. Please try again." }
  }

  // Erase the Cloudinary assets off the request path — a storage outage must
  // never fail a delete that already committed.
  if (assets.length > 0) after(async () => destroyAssets(assets))

  updateTag(`form-${formId}`)
  updateTag(`workspace-forms-${workspace.id}`)
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
  successBody?: string | null
  successVideoUrl?: string | null
  // Response experience (classic vs conversational chat).
  renderMode?: "classic" | "conversational"
  persona?: string | null
  followUpsEnabled?: boolean
  clarifyVagueAnswers?: boolean
  // Submission intelligence (post-submit AI; opt-in).
  summaryEnabled?: boolean
  screeningEnabled?: boolean
  screeningCriteria?: string | null
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
    patch.thankYouMessage !== undefined ||
    patch.successBody !== undefined ||
    patch.successVideoUrl !== undefined
  ) {
    const settings: FormSettings = { ...(row.settings ?? {}) }
    if (patch.showProgressBar !== undefined) settings.showProgressBar = patch.showProgressBar
    if (patch.submitButtonLabel !== undefined)
      settings.submitButtonLabel = patch.submitButtonLabel?.trim() || undefined
    if (patch.thankYouMessage !== undefined)
      settings.thankYouMessage = patch.thankYouMessage?.trim() || undefined
    if (patch.successBody !== undefined)
      settings.successBody = patch.successBody?.trim() || undefined
    if (patch.successVideoUrl !== undefined)
      settings.successVideoUrl = patch.successVideoUrl?.trim() || undefined
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
    patch.clarifyVagueAnswers !== undefined ||
    patch.summaryEnabled !== undefined ||
    patch.screeningEnabled !== undefined ||
    patch.screeningCriteria !== undefined
  ) {
    const aiConfig: FormAiConfig = { ...(row.aiConfig ?? {}) }
    if (patch.persona !== undefined) aiConfig.persona = patch.persona?.trim() || undefined
    if (patch.followUpsEnabled !== undefined) aiConfig.followUpsEnabled = patch.followUpsEnabled
    if (patch.clarifyVagueAnswers !== undefined)
      aiConfig.clarifyVagueAnswers = patch.clarifyVagueAnswers
    if (patch.summaryEnabled !== undefined) aiConfig.summaryEnabled = patch.summaryEnabled
    if (patch.screeningEnabled !== undefined) aiConfig.screeningEnabled = patch.screeningEnabled
    if (patch.screeningCriteria !== undefined)
      aiConfig.screeningCriteria = patch.screeningCriteria?.trim() || undefined
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
  updateTag(`form-${formId}`) // status/settings/theme affect the public form
  updateTag(`workspace-forms-${workspace.id}`) // close form changes the list status
  revalidatePath(`/forms/${formId}`, "layout")
  return { success: true }
}
