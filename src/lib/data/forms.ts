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

/** Forms in the caller's workspace, newest first — for the /forms list. */
export async function getWorkspaceForms() {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return []

  return db
    .select({
      id: forms.id,
      title: forms.title,
      status: forms.status,
      publicId: forms.publicId,
      updatedAt: forms.updatedAt,
    })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
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

  const [row] = await db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.id, id),
        eq(forms.workspaceId, workspace.id),
        isNull(forms.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null

  const fields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formId, id), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)

  const form: EditorForm = {
    title: row.title,
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

  let domain: string | null = null
  if (row.customDomainId) {
    const [d] = await db
      .select({ domain: customDomains.domain })
      .from(customDomains)
      .where(eq(customDomains.id, row.customDomainId))
      .limit(1)
    domain = d?.domain ?? null
  }

  return {
    id: row.id,
    form,
    status: row.status,
    publicId: row.publicId,
    customDomainId: row.customDomainId,
    slug: row.slug,
    domain,
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
}

/** Lightweight header for the form-detail pages (no fields). Workspace-scoped. */
export async function getFormShell(id: string): Promise<FormShell | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null
  const [row] = await db
    .select({
      id: forms.id,
      title: forms.title,
      status: forms.status,
      publicId: forms.publicId,
      customDomainId: forms.customDomainId,
      slug: forms.slug,
      domain: customDomains.domain,
    })
    .from(forms)
    .leftJoin(customDomains, eq(customDomains.id, forms.customDomainId))
    .where(and(eq(forms.id, id), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  return row ?? null
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
  // Response experience (classic vs conversational chat).
  renderMode: "classic" | "conversational"
  aiEnabled: boolean
  persona: string
  followUpsEnabled: boolean
  clarifyVagueAnswers: boolean
  // Branding (logo + banner).
  logoUrl: string | null
  coverImageUrl: string | null
}

/** Current response-collection settings for the Settings tab. Workspace-scoped. */
export async function getFormSettings(id: string): Promise<FormSettingsData | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null
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
    })
    .from(forms)
    .where(and(eq(forms.id, id), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
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
    renderMode: row.renderMode,
    aiEnabled: row.aiEnabled,
    persona: row.aiConfig?.persona ?? "",
    followUpsEnabled: row.aiConfig?.followUpsEnabled ?? false,
    clarifyVagueAnswers: row.aiConfig?.clarifyVagueAnswers ?? false,
    logoUrl: row.theme?.logoUrl ?? null,
    coverImageUrl: row.theme?.coverImageUrl ?? null,
  }
}

export type SubmissionColumn = {
  id: string
  label: string
  type: string
  options: { id: string; label: string }[] | null
}

export type SubmissionsTable = {
  columns: SubmissionColumn[]
  rows: { id: string; submittedAt: Date; values: Record<string, AnswerValue> }[]
}

/** Submissions for the responses table — columns = answerable fields, rows = answers. */
export async function getFormSubmissions(
  id: string,
  limit = 200,
): Promise<SubmissionsTable | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.id, id), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return null

  const fields = await db
    .select({
      id: formFields.id,
      label: formFields.label,
      type: formFields.type,
      options: formFields.options,
    })
    .from(formFields)
    .where(and(eq(formFields.formId, id), isNull(formFields.deletedAt)))
    .orderBy(formFields.position)
  const columns: SubmissionColumn[] = fields
    .filter((f) => !NON_ANSWER_TYPES.has(f.type))
    .map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      options: f.options ? f.options.map((o) => ({ id: o.id, label: o.label })) : null,
    }))

  const subs = await db
    .select({ id: submissions.id, submittedAt: submissions.createdAt })
    .from(submissions)
    .where(and(eq(submissions.formId, id), eq(submissions.status, "completed")))
    .orderBy(desc(submissions.createdAt))
    .limit(limit)

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
    rows: subs.map((s) => ({ id: s.id, submittedAt: s.submittedAt, values: byId.get(s.id) ?? {} })),
  }
}
