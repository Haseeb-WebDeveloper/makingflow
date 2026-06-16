import { cacheLife, cacheTag } from "next/cache"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formFields,
  submissions,
  answers,
  customDomains,
  type AnswerValue,
} from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { NON_ANSWER_TYPES } from "@/lib/builder/logic"
import type { AiFieldType } from "@/lib/ai/form-schema"
import type { EditorForm } from "@/lib/builder/form-model"

/**
 * Forms in the workspace, newest first — for the /forms list + sidebar. Runs in
 * the dashboard layout on every navigation, so it's cached per workspace and
 * invalidated by `updateTag(workspace-forms-${id})` on any form create / edit /
 * publish / rename / duplicate / delete.
 */
export async function getWorkspaceForms(workspaceId: string) {
  "use cache"
  cacheLife("minutes")
  cacheTag(`workspace-forms-${workspaceId}`)
  return db
    .select({
      id: forms.id,
      title: forms.title,
      status: forms.status,
      publicId: forms.publicId,
      folderId: forms.folderId,
      updatedAt: forms.updatedAt,
    })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .orderBy(desc(forms.updatedAt))
}

export type EditableForm = {
  id: string
  form: EditorForm
  status: string
  publicId: string
  customDomainId: string | null
  slug: string | null
  domain: string | null
}

/** Load one form (workspace-scoped) and map it back to the AI form spec. */
export async function getFormForEdit(id: string): Promise<EditableForm | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  // Form row (with its custom domain folded in via leftJoin) and its fields are
  // independent — one round-trip instead of form → fields → domain in series.
  const [formRows, fields] = await Promise.all([
    db
      .select({ form: forms, domain: customDomains.domain })
      .from(forms)
      .leftJoin(customDomains, eq(customDomains.id, forms.customDomainId))
      .where(and(eq(forms.id, id), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
      .limit(1),
    db
      .select()
      .from(formFields)
      .where(and(eq(formFields.formId, id), isNull(formFields.deletedAt)))
      .orderBy(formFields.position),
  ])
  const row = formRows[0]
  if (!row) return null // not owned — discard the parallel fields read

  const form: EditorForm = {
    title: row.form.title,
    fields: fields.map((f) => ({
      id: f.id,
      type: f.type as AiFieldType,
      label: f.label,
      description: f.description ?? undefined,
      placeholder: f.placeholder ?? undefined,
      required: f.required,
      options: f.options ?? undefined,
      logic: f.logic ?? undefined,
      config: f.config ?? undefined,
    })),
  }

  return {
    id: row.form.id,
    form,
    status: row.form.status,
    publicId: row.form.publicId,
    customDomainId: row.form.customDomainId,
    slug: row.form.slug,
    domain: row.domain ?? null,
  }
}

export type FormShell = {
  id: string
  title: string
  status: string
  publicId: string
  customDomainId: string | null
  domain: string | null
  slug: string | null
  // True when post-submit AI summary/screening is opted in (drives the
  // response-detail "Generate" affordance).
  intelligenceEnabled: boolean
}

/**
 * Lightweight header for the form-detail pages (no fields). Cached per form;
 * invalidated by `updateTag(form-${id})` on any form mutation (incl. domain
 * attach). Doubles as the tenancy guard — the manage layout and tab pages all
 * call it and share the cached result.
 */
export async function getFormShell(id: string, workspaceId: string): Promise<FormShell | null> {
  "use cache"
  cacheLife("minutes")
  cacheTag(`form-${id}`)
  const [row] = await db
    .select({
      id: forms.id,
      title: forms.title,
      status: forms.status,
      publicId: forms.publicId,
      customDomainId: forms.customDomainId,
      slug: forms.slug,
      domain: customDomains.domain,
      aiConfig: forms.aiConfig,
    })
    .from(forms)
    .leftJoin(customDomains, eq(customDomains.id, forms.customDomainId))
    .where(and(eq(forms.id, id), eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  if (!row) return null
  const { aiConfig, ...shell } = row
  return {
    ...shell,
    intelligenceEnabled:
      !!aiConfig?.summaryEnabled ||
      (!!aiConfig?.screeningEnabled && !!aiConfig?.screeningCriteria?.trim()),
  }
}

export type FormSettingsData = {
  status: string
  submissionLimit: number | null
  closesAt: string | null
  redirectUrl: string | null
  oneResponsePerPerson: boolean
  showProgressBar: boolean
  submitButtonLabel: string
  thankYouMessage: string
  successBody: string
  successVideoUrl: string | null
  // Response experience (classic vs conversational chat).
  renderMode: "classic" | "conversational"
  aiEnabled: boolean
  persona: string
  followUpsEnabled: boolean
  clarifyVagueAnswers: boolean
  // Submission intelligence (post-submit AI; opt-in, both off by default).
  summaryEnabled: boolean
  screeningEnabled: boolean
  screeningCriteria: string
  // Branding (logo + banner).
  logoUrl: string | null
  coverImageUrl: string | null
  // Organizing folder (sidebar grouping); null = Uncategorized.
  folderId: string | null
}

/** Current response-collection settings for the Settings tab. Cached per form
 *  (`form-${id}` tag); invalidated whenever the form's settings change. */
export async function getFormSettings(id: string, workspaceId: string): Promise<FormSettingsData | null> {
  "use cache"
  cacheLife("minutes")
  cacheTag(`form-${id}`)
  const [row] = await db
    .select({
      status: forms.status,
      submissionLimit: forms.submissionLimit,
      closesAt: forms.closesAt,
      redirectUrl: forms.redirectUrl,
      oneResponsePerPerson: forms.oneResponsePerPerson,
      settings: forms.settings,
      renderMode: forms.renderMode,
      aiEnabled: forms.aiEnabled,
      aiConfig: forms.aiConfig,
      theme: forms.theme,
      folderId: forms.folderId,
    })
    .from(forms)
    .where(and(eq(forms.id, id), eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  if (!row) return null
  return {
    status: row.status,
    submissionLimit: row.submissionLimit,
    closesAt: row.closesAt ? row.closesAt.toISOString() : null,
    redirectUrl: row.redirectUrl,
    oneResponsePerPerson: row.oneResponsePerPerson,
    showProgressBar: row.settings?.showProgressBar ?? false,
    submitButtonLabel: row.settings?.submitButtonLabel ?? "",
    thankYouMessage: row.settings?.thankYouMessage ?? "",
    successBody: row.settings?.successBody ?? "",
    successVideoUrl: row.settings?.successVideoUrl ?? null,
    renderMode: row.renderMode,
    aiEnabled: row.aiEnabled,
    persona: row.aiConfig?.persona ?? "",
    followUpsEnabled: row.aiConfig?.followUpsEnabled ?? false,
    clarifyVagueAnswers: row.aiConfig?.clarifyVagueAnswers ?? false,
    summaryEnabled: row.aiConfig?.summaryEnabled ?? false,
    screeningEnabled: row.aiConfig?.screeningEnabled ?? false,
    screeningCriteria: row.aiConfig?.screeningCriteria ?? "",
    logoUrl: row.theme?.logoUrl ?? null,
    coverImageUrl: row.theme?.coverImageUrl ?? null,
    folderId: row.folderId,
  }
}

export type SubmissionColumn = {
  id: string
  label: string
  type: string
  options: { id: string; label: string }[] | null
}

export type SubmissionRowData = {
  id: string
  submittedAt: Date
  values: Record<string, AnswerValue>
  aiSummary: string | null
  aiScore: number | null
  aiScreenReason: string | null
}

export type SubmissionsTable = {
  columns: SubmissionColumn[]
  rows: SubmissionRowData[]
}

/** Submissions for the responses table — columns = answerable fields, rows = answers. */
export async function getFormSubmissions(
  id: string,
  limit = 200,
): Promise<SubmissionsTable | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  // The tenancy guard, the field list, and the submission list are independent —
  // run them in one round-trip instead of three serial hops to the remote DB.
  const [formRows, fields, subs] = await Promise.all([
    db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
      .limit(1),
    db
      .select({
        id: formFields.id,
        label: formFields.label,
        type: formFields.type,
        options: formFields.options,
      })
      .from(formFields)
      .where(and(eq(formFields.formId, id), isNull(formFields.deletedAt)))
      .orderBy(formFields.position),
    db
      .select({
        id: submissions.id,
        submittedAt: submissions.createdAt,
        aiSummary: submissions.aiSummary,
        aiScore: submissions.aiScore,
        aiScreenReason: submissions.aiScreenReason,
      })
      .from(submissions)
      .where(and(eq(submissions.formId, id), eq(submissions.status, "completed")))
      .orderBy(desc(submissions.createdAt))
      .limit(limit),
  ])
  if (!formRows[0]) return null // not owned — discard the parallel reads

  const columns: SubmissionColumn[] = fields
    .filter((f) => !NON_ANSWER_TYPES.has(f.type))
    .map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      options: f.options ? f.options.map((o) => ({ id: o.id, label: o.label })) : null,
    }))

  if (subs.length === 0) return { columns, rows: [] }

  const subIds = subs.map((s) => s.id)
  const ans = await db
    .select({
      submissionId: answers.submissionId,
      fieldId: answers.fieldId,
      value: answers.value,
    })
    .from(answers)
    .where(inArray(answers.submissionId, subIds))

  const byId = new Map<string, Record<string, AnswerValue>>()
  for (const s of subs) byId.set(s.id, {})
  for (const a of ans) {
    if (!a.fieldId) continue
    const bucket = byId.get(a.submissionId)
    if (bucket) bucket[a.fieldId] = a.value
  }

  return {
    columns,
    rows: subs.map((s) => ({
      id: s.id,
      submittedAt: s.submittedAt,
      values: byId.get(s.id) ?? {},
      aiSummary: s.aiSummary,
      aiScore: s.aiScore,
      aiScreenReason: s.aiScreenReason,
    })),
  }
}
