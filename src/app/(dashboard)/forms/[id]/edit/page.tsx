import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { getFormForEdit, getFormSettings } from "@/lib/data/forms"
import { getActiveDomains } from "@/lib/data/domains"
import { getWorkspaceFolders } from "@/lib/data/folders"
import { FormBuilder } from "@/components/builder/form-builder"

export const metadata: Metadata = { title: "Edit form · MakingFlow" }

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()
  const [data, settings, domains, folders] = await Promise.all([
    getFormForEdit(id),
    getFormSettings(id, workspace.id),
    getActiveDomains(workspace.id),
    getWorkspaceFolders(workspace.id),
  ])
  if (!data) notFound()

  return (
    <FormBuilder
      // Remount when switching between forms — under cacheComponents (Activity)
      // the same [id] route instance is reused, which would otherwise keep the
      // previous form's chat/draft/save state.
      key={data.id}
      initialForm={data.form}
      initialFormId={data.id}
      initialStatus={data.status}
      initialPublicId={data.publicId}
      initialDomainId={data.customDomainId}
      initialSlug={data.slug}
      initialDomainHost={data.domain}
      domains={domains}
      folders={folders}
      initialSettings={settings}
    />
  )
}
