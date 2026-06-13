import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getFormShell, getFormSubmissions } from "@/lib/data/forms"
import { SubmissionsTable, type Cell } from "@/components/forms/submissions-table"
import type { AnswerValue } from "@/lib/db/schema"

export const metadata: Metadata = { title: "Submissions · MakingFlow" }

const FILE_TYPES = new Set(["file_upload", "signature"])

function toCell(v: AnswerValue | undefined, type: string): Cell {
  if (FILE_TYPES.has(type) && v && typeof v === "object" && !Array.isArray(v)) {
    const raw = (v as { files?: unknown }).files
    if (Array.isArray(raw)) {
      const files = raw
        .map((f) => ({ name: String((f as { name?: unknown }).name ?? "file"), url: String((f as { url?: unknown }).url ?? "") }))
        .filter((f) => f.url)
      return { kind: "files", files }
    }
  }
  return formatAnswer(v)
}

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
    cells: data.columns.map((c) => toCell(r.values[c.id], c.type)),
  }))

  return (
    <SubmissionsTable
      columns={data.columns.map((c) => c.label)}
      rows={rows}
      formTitle={shell.title}
    />
  )
}
