import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { getFormShell, getFormSubmissionCounts, getFormSubmissionsPage } from "@/lib/data/forms"
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
  // A keyset page rather than the old flat cap, so "Load more" has somewhere to
  // continue from. The true total still comes from getFormSubmissionCounts, so
  // the table can say how much of it is on screen.
  const [shell, data, counts] = await Promise.all([
    getFormShell(id, workspace.id),
    getFormSubmissionsPage(id, workspace.id, { limit: 50, withAnswers: true }),
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
      nextCursor={data.nextCursor}
      intelligenceEnabled={shell.intelligenceEnabled}
    />
  )
}
