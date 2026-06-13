import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getFormForEdit, getFormSettings } from "@/lib/data/forms"
import { getActiveDomains } from "@/lib/data/domains"
import { FormBuilder } from "@/components/builder/form-builder"

export const metadata: Metadata = { title: "Edit form · MakingFlow" }

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, settings, domains] = await Promise.all([
    getFormForEdit(id),
    getFormSettings(id),
    getActiveDomains(),
  ])
  if (!data) notFound()

  return (
    <FormBuilder
      initialForm={data.form}
      initialFormId={data.id}
      initialStatus={data.status}
      initialPublicId={data.publicId}
      initialDomainId={data.customDomainId}
      initialSlug={data.slug}
      initialDomainHost={data.domain}
      domains={domains}
      initialSettings={settings}
    />
  )
}
