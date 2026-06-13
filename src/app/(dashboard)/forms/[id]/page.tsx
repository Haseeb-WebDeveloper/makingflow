import { redirect } from "next/navigation"

/** The form's default management view is Submissions. */
export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/forms/${id}/submissions`)
}
