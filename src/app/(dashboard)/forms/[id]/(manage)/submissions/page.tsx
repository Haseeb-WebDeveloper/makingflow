import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { getFormShell, getFormSubmissionCounts, getFormSubmissions } from "@/lib/data/forms"
import { SubmissionsView } from "@/components/forms/submissions-view"

export const metadata: Metadata = { title: "Submissions · MakingFlow" }

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()
  // `data.rows` is a capped page, not the whole set — the true total comes from
  // getFormSubmissionCounts so the table can say how much it isn't showing.
  const [shell, data, counts] = await Promise.all([
    getFormShell(id, workspace.id),
    getFormSubmissions(id),
    getFormSubmissionCounts(id, workspace.id),
  ])
  if (!shell || !data) notFound()

  const rawRows = data.rows.map((r) => ({
    id: r.id,
    submittedAt: r.submittedAt.toISOString(),
    values: r.values,
    aiSummary: r.aiSummary,
    aiScore: r.aiScore,
    aiScreenReason: r.aiScreenReason,
  }))

  return (
    <SubmissionsView
      formId={id}
      columns={data.columns}
      rawRows={rawRows}
      totalCompleted={counts?.completed ?? rawRows.length}
      intelligenceEnabled={shell.intelligenceEnabled}
    />
  )
}
