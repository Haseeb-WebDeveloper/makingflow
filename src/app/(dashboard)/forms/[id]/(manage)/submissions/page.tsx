import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getFormShell, getFormSubmissions } from "@/lib/data/forms"
import { SubmissionsView } from "@/components/forms/submissions-view"

export const metadata: Metadata = { title: "Submissions · MakingFlow" }

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [shell, data] = await Promise.all([getFormShell(id), getFormSubmissions(id)])
  if (!shell || !data) notFound()

  const rawRows = data.rows.map((r) => ({
    id: r.id,
    submittedAt: r.submittedAt.toISOString(),
    values: r.values,
  }))

  return <SubmissionsView columns={data.columns} rawRows={rawRows} formTitle={shell.title} />
}
