import { redirect } from "next/navigation"

/**
 * The form's default management view is Insights — an at-a-glance overview of
 * how the form is performing. (A brand-new form lands here on a clean "no
 * responses yet" state rather than a dead-end empty Submissions inbox.)
 */
export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/forms/${id}/insights`)
}
