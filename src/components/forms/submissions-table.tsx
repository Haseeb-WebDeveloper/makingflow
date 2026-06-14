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

export type Cell = string | { kind: "files"; files: { name: string; url: string }[] }

export type SubmissionRow = {
  id: string
  submittedAt: string // ISO
  cells: Cell[]
}

/** Pure responses table — columns are the form's answerable fields, one row per
 * submission. Filtering/search/export live in SubmissionsView. */
export function SubmissionsTable({
  columns,
  rows,
  onDelete,
}: {
  columns: string[]
  rows: SubmissionRow[]
  onDelete?: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
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
            {onDelete ? (
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const toggle = () => setExpanded(expanded === r.id ? null : r.id)
            return (
            <TableRow
              key={r.id}
              tabIndex={0}
              aria-expanded={expanded === r.id}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  toggle()
                }
              }}
              className="cursor-pointer align-top outline-none focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(r.submittedAt)}
              </TableCell>
              {r.cells.map((cell, i) => (
                <TableCell
                  key={i}
                  className={expanded === r.id ? "whitespace-pre-wrap" : "max-w-xs truncate"}
                >
                  {renderCell(cell)}
                </TableCell>
              ))}
              {onDelete ? (
                <TableCell className="w-10 text-right">
                  <button
                    type="button"
                    aria-label="Delete response"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(r.id)
                    }}
                    className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Icon name="delete" className="size-4" />
                  </button>
                </TableCell>
              ) : null}
            </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const EMPTY = <span className="text-muted-foreground">—</span>

function renderCell(cell: Cell) {
  if (typeof cell === "string") return cell || EMPTY
  if (cell.files.length === 0) return EMPTY
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {cell.files.map((f, i) => (
        <a
          key={i}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary hover:underline"
        >
          {f.name}
        </a>
      ))}
    </span>
  )
}

export function cellToText(cell: Cell): string {
  return typeof cell === "string" ? cell : cell.files.map((f) => f.url).join(" ")
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}
