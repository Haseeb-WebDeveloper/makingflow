import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getFormShell, getFormSubmissions } from "@/lib/data/forms"
import { SubmissionsTable } from "@/components/forms/submissions-table"
import type { AnswerValue } from "@/lib/db/schema"

export const metadata: Metadata = { title: "Submissions · MakingFlow" }

function formatAnswer(v: AnswerValue | undefined): string {
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [shell, data] = await Promise.all([getFormShell(id), getFormSubmissions(id)])
  if (!shell || !data) notFound()

  const rows = data.rows.map((r) => ({
    id: r.id,
    submittedAt: r.submittedAt.toISOString(),
    cells: data.columns.map((c) => formatAnswer(r.values[c.id])),
  }))

  return (
    <SubmissionsTable
      columns={data.columns.map((c) => c.label)}
      rows={rows}
      formTitle={shell.title}
    />
  )
}
