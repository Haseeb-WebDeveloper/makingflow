import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { getFormSettings } from "@/lib/data/forms"
import { FormSettings } from "@/components/forms/form-settings"

export const metadata: Metadata = { title: "Form settings · MakingFlow" }

export default async function FormSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()
  const settings = await getFormSettings(id, workspace.id)
  if (!settings) notFound()

  return <FormSettings formId={id} initial={settings} />
}
