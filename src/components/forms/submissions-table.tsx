"use client"

import { useState } from "react"
import { Icon } from "@/components/ui/icon"
import { Badge } from "@/components/ui/badge"
import { ResizeHandle, useColumnWidths } from "@/components/ui/resizable-columns"
import { cn } from "@/lib/utils"

/**
 * The responses table.
 *
 * A CSS GRID, NOT A `<table>`, and the reason is column widths. A real table
 * sizes its columns from their content, so one long answer widens a column and
 * shoves the rest off screen, and nothing a person drags can survive the next
 * render. A grid of fixed pixel tracks inside a horizontally scrolling
 * container is what every database table actually does: the table stops trying
 * to fit the screen and the screen scrolls instead.
 *
 * DENSITY IS THE POINT OF THE REWRITE. This was 48px rows of 14px text, which
 * put about sixteen responses on a laptop screen. Rows are 32px now with 13px
 * text, so the same screen shows roughly twenty-four — and reading down one
 * column, which is what scanning responses actually is, stops being a scroll.
 * The geometry matches the office dashboard this borrows from.
 *
 * SORTING IS CLIENT-SIDE, and that is a deliberate difference from the table
 * this is modelled on. Theirs sorts in the database because its lists are
 * unbounded; ours holds every loaded response in memory already, because the
 * search box and the filters work over them. Sorting here composes with both —
 * and it means ANSWER columns sort too, which a server sort could not do
 * without a join per column.
 */

/** Badge tone for a 0–100 fit score: strong / medium / weak. */
export function scoreVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default"
  if (score >= 40) return "secondary"
  return "destructive"
}

export type Cell = string | { kind: "files"; files: { name: string; url: string }[] }

export type SubmissionRow = {
  id: string
  submittedAt: string // ISO
  cells: Cell[]
}

/**
 * `submitted` and `score` are fixed columns; a number is an answer column's
 * index. Null is the form's own order, newest first.
 */
export type SortKey = "submitted" | "score" | number
export type SortState = { key: SortKey; dir: "asc" | "desc" } | null

/** Matches the office dashboard's row rhythm. */
const ROW_HEIGHT = 32
const ACTIONS_WIDTH = 36

const DEFAULT_WIDTHS = { submitted: 150, score: 72 }
const DEFAULT_ANSWER_WIDTH = 200

export function SubmissionsTable({
  formId,
  columns,
  rows,
  onDelete,
  onOpen,
  showScore = false,
  scoreById,
  sort,
  onSort,
}: {
  /** Scopes the stored column widths, so two forms do not share a layout. */
  formId: string
  columns: string[]
  rows: SubmissionRow[]
  onDelete?: (id: string) => void
  /** When set, clicking a row opens the detail panel instead of inline-expanding. */
  onOpen?: (id: string) => void
  /** Render a leading Score column (screening enabled). */
  showScore?: boolean
  scoreById?: Map<string, number | null>
  sort: SortState
  onSort: (key: SortKey) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // Keyed by column identity, not position: inserting a question should not
  // hand its width to the one that used to sit there.
  const defaults: Record<string, number> = { submitted: DEFAULT_WIDTHS.submitted }
  if (showScore) defaults.score = DEFAULT_WIDTHS.score
  columns.forEach((_, i) => {
    defaults[`c${i}`] = DEFAULT_ANSWER_WIDTH
  })

  const { widths, template, totalWidth, startResize, resetColumn } = useColumnWidths(
    `submissions:${formId}`,
    defaults,
  )

  const gridStyle = {
    "--cols": `${template}${onDelete ? ` ${ACTIONS_WIDTH}px` : ""}`,
  } as React.CSSProperties

  const heads: { id: string; label: string; key: SortKey }[] = [
    { id: "submitted", label: "Submitted", key: "submitted" },
    ...(showScore ? [{ id: "score", label: "Score", key: "score" as SortKey }] : []),
    ...columns.map((c, i) => ({
      id: `c${i}`,
      label: c || `Question ${i + 1}`,
      key: i as SortKey,
    })),
  ]

  return (
    <div className="thin-scroll overflow-x-auto rounded-lg border border-border">
      <div style={{ minWidth: totalWidth + (onDelete ? ACTIONS_WIDTH : 0) }}>
        <div
          style={gridStyle}
          className="grid grid-cols-(--cols) border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground"
        >
          {heads.map((h) => {
            const active = sort?.key === h.key
            return (
              <div
                key={h.id}
                className="group/head relative flex min-w-0 items-center border-r border-border/60 last:border-r-0"
                style={{ height: ROW_HEIGHT }}
              >
                <button
                  type="button"
                  onClick={() => onSort(h.key)}
                  title={`Sort by ${h.label}`}
                  className="flex min-w-0 flex-1 items-center gap-1 px-2 text-left hover:text-foreground"
                >
                  <span className="truncate">{h.label}</span>
                  {/* Only the active column shows a direction. An arrow on every
                      header is noise, and a grey one on the inactive columns
                      reads as "sorted, ascending" at a glance. */}
                  {active ? <SortArrow dir={sort.dir} /> : null}
                </button>
                <ResizeHandle
                  label={h.label}
                  onResize={(e) => startResize(h.id, e)}
                  onReset={() => resetColumn(h.id)}
                />
              </div>
            )
          })}
          {onDelete ? <div style={{ height: ROW_HEIGHT }} /> : null}
        </div>

        {rows.map((r) => {
          const isOpen = expanded === r.id
          const toggle = () => (onOpen ? onOpen(r.id) : setExpanded(isOpen ? null : r.id))
          const score = scoreById?.get(r.id)
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              aria-expanded={onOpen ? undefined : isOpen}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  toggle()
                }
              }}
              style={gridStyle}
              className={cn(
                "grid cursor-pointer grid-cols-(--cols) border-b border-border/60 text-[13px] outline-none last:border-b-0",
                "hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              )}
            >
              <Cell width={widths.submitted} expanded={isOpen} muted>
                {formatDate(r.submittedAt)}
              </Cell>

              {showScore ? (
                <Cell width={widths.score} expanded={isOpen}>
                  {score != null ? (
                    <Badge variant={scoreVariant(score)}>{score}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Cell>
              ) : null}

              {r.cells.map((cell, i) => (
                <Cell key={i} width={widths[`c${i}`]} expanded={isOpen}>
                  {renderCell(cell)}
                </Cell>
              ))}

              {onDelete ? (
                <div
                  className="flex items-center justify-center"
                  style={{ minHeight: ROW_HEIGHT }}
                >
                  <button
                    type="button"
                    aria-label="Delete response"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(r.id)
                    }}
                    className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Icon name="delete" className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The sort direction, as a triangle.
 *
 * Drawn here rather than taken from the icon set, which has no directional
 * glyph — the nearest candidates are `download` and `upload`, and a tray with an
 * arrow through it does not mean "ascending". Six lines of SVG beats teaching
 * someone that a download icon sorts a column.
 */
function SortArrow({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden
      className={cn("size-2 shrink-0 fill-current", dir === "asc" && "rotate-180")}
    >
      <path d="M4 6.5 0.5 2h7z" />
    </svg>
  )
}

/**
 * One cell.
 *
 * `min-w-0` is load-bearing on a grid track: without it a long answer sets the
 * track's minimum to its own content width and the whole row stops respecting
 * the widths above — which is the bug that made the old fractional layout spill
 * one column into the next.
 */
function Cell({
  width,
  expanded,
  muted,
  children,
}: {
  width?: number
  expanded: boolean
  muted?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      style={{ minHeight: ROW_HEIGHT, width }}
      className={cn(
        "flex min-w-0 items-center border-r border-border/40 px-2 py-1 last:border-r-0",
        expanded ? "whitespace-pre-wrap break-words" : "truncate",
        muted && "text-muted-foreground",
      )}
    >
      <span className={expanded ? "min-w-0" : "min-w-0 truncate"}>{children}</span>
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
