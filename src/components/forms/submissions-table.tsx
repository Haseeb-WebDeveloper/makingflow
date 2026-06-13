"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Icon } from "@/components/ui/icon"

export type SubmissionRow = {
  id: string
  submittedAt: string // ISO
  cells: string[]
}

/** Responses table — columns are the form's answerable fields, one row per
 * completed submission. Includes CSV export. */
export function SubmissionsTable({
  columns,
  rows,
  formTitle,
}: {
  columns: string[]
  rows: SubmissionRow[]
  formTitle: string
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-20 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon name="folder" className="size-5" />
        </span>
        <p className="text-sm font-medium text-foreground">No submissions yet</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Responses will show up here as people fill out your form. Share it to start
          collecting.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "response" : "responses"}
        </p>
        <button
          type="button"
          onClick={() => exportCsv(formTitle, columns, rows)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Icon name="download" className="size-4" />
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Submitted</TableHead>
              {columns.map((c, i) => (
                <TableHead key={i} className="whitespace-nowrap">
                  {c || `Question ${i + 1}`}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="cursor-pointer align-top"
              >
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(r.submittedAt)}
                </TableCell>
                {r.cells.map((cell, i) => (
                  <TableCell
                    key={i}
                    className={expanded === r.id ? "whitespace-pre-wrap" : "max-w-xs truncate"}
                  >
                    {cell || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}

function exportCsv(formTitle: string, columns: string[], rows: SubmissionRow[]) {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const header = ["Submitted", ...columns].map(esc).join(",")
  const body = rows
    .map((r) => [formatDate(r.submittedAt), ...r.cells].map(esc).join(","))
    .join("\n")
  const csv = `${header}\n${body}`
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${formTitle.replace(/[^\w-]+/g, "-").toLowerCase() || "form"}-submissions.csv`
  a.click()
  URL.revokeObjectURL(url)
}
