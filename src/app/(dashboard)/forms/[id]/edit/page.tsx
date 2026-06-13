import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getFormForEdit } from "@/lib/data/forms"
import { FormBuilder } from "@/components/builder/form-builder"

export const metadata: Metadata = { title: "Edit form · MakingFlow" }

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await getFormForEdit(id)
  if (!data) notFound()

  return (
    <FormBuilder
      initialForm={data.form}
      initialFormId={data.id}
      initialStatus={data.status}
      initialPublicId={data.publicId}
    />
  )
}
