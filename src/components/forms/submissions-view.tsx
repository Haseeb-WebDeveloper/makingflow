"use client"

import { useMemo, useState, useTransition } from "react"
import { Icon } from "@/components/ui/icon"
import {
  SubmissionsTable,
  cellToText,
  type Cell,
  type SortKey,
  type SortState,
  type SubmissionRow,
} from "@/components/forms/submissions-table"
import { SubmissionsFilterDialog } from "@/components/forms/submissions-filter-dialog"
import { SubmissionDetailSheet, type SubmissionDetail } from "@/components/forms/submission-detail"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { showToast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { deleteSubmission, loadMoreSubmissions } from "@/lib/actions/submissions"
import {
  applyFilters,
  type Filter,
  type FilterColumn,
  type MatchMode,
  type RawRow,
} from "@/lib/submissions/filter"
import { conditionComplete } from "@/lib/builder/logic"
import type { AnswerValue } from "@/lib/db/schema"

const FILE_TYPES = new Set(["file_upload", "signature"])

function toCell(v: AnswerValue | undefined, type: string): Cell {
  if (FILE_TYPES.has(type) && v && typeof v === "object" && !Array.isArray(v)) {
    const raw = (v as { files?: unknown }).files
    if (Array.isArray(raw)) {
      const files = raw
        .map((f) => ({
          name: String((f as { name?: unknown }).name ?? "file"),
          url: String((f as { url?: unknown }).url ?? ""),
        }))
        .filter((f) => f.url)
      return { kind: "files", files }
    }
  }
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export function SubmissionsView({
  formId,
  columns,
  rawRows,
  totalCompleted,
  nextCursor = null,
  intelligenceEnabled = false,
}: {
  formId: string
  columns: FilterColumn[]
  rawRows: RawRow[]
  /** Every completed response the form has, not just the page in `rawRows`. */
  totalCompleted: number
  /** Opaque cursor for the next page, or null when this is all of them. */
  nextCursor?: string | null
  intelligenceEnabled?: boolean
}) {
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<Filter[]>([])
  const [match, setMatch] = useState<MatchMode>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [isDeleting, startDelete] = useTransition()
  const [sort, setSort] = useState<SortState>(null)
  // Pages fetched since the first render, appended to the ones the server sent.
  const [extraRows, setExtraRows] = useState<RawRow[]>([])
  const [cursor, setCursor] = useState<string | null>(nextCursor)
  const [isLoadingMore, startLoadMore] = useTransition()

  /**
   * Three clicks per column: descending, ascending, back to the form's own
   * order. The third is what makes the control safe to try — without it,
   * sorting is a door that does not close, and the only way back to "newest
   * first" is a page reload.
   */
  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "desc" }
      if (current.dir === "desc") return { key, dir: "asc" }
      return null
    })
  }

  function loadMore() {
    if (!cursor) return
    startLoadMore(async () => {
      const res = await loadMoreSubmissions(formId, cursor)
      if (!res.success) {
        showToast(res.error, { type: "error" })
        return
      }
      setExtraRows((prev) => [...prev, ...res.rows])
      setCursor(res.nextCursor)
    })
  }

  // Locally hide rows the owner has deleted so the table updates instantly; a
  // server refresh (revalidatePath) already excludes them, so the set is just a
  // harmless no-op afterwards.
  const allRows = useMemo(
    () => (extraRows.length === 0 ? rawRows : [...rawRows, ...extraRows]),
    [rawRows, extraRows],
  )

  const liveRows = useMemo(
    () => (deletedIds.size === 0 ? allRows : allRows.filter((r) => !deletedIds.has(r.id))),
    [allRows, deletedIds],
  )

  const filtered = useMemo(
    () => applyFilters(liveRows, columns, { search, filters, match }),
    [liveRows, columns, search, filters, match],
  )
  const displayRows: SubmissionRow[] = useMemo(() => {
    const mapped = filtered.map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt,
      cells: columns.map((c) => toCell(r.values[c.id], c.type)),
      score: r.aiScore ?? null,
    }))

    // Sorting AFTER filtering, over every loaded row. This is why sorting is
    // client-side: the search box and the filters already work this way, so a
    // server sort would have to re-fetch and would still only order the page it
    // fetched — the two would disagree the moment somebody typed anything.
    if (!sort) return mapped
    const dir = sort.dir === "asc" ? 1 : -1
    return [...mapped].sort((a, b) => {
      if (sort.key === "submitted") {
        return dir * (Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
      }
      if (sort.key === "score") {
        // Unscored responses sit at the end either way. They are not "zero" —
        // ranking them below a genuine 0 would be inventing a judgement.
        if (a.score == null || b.score == null) {
          return a.score == null ? (b.score == null ? 0 : 1) : -1
        }
        return dir * (a.score - b.score)
      }
      const left = cellToText(a.cells[sort.key] ?? "")
      const right = cellToText(b.cells[sort.key] ?? "")
      // Empty answers go last regardless of direction, for the same reason.
      if (!left || !right) return !left ? (!right ? 0 : 1) : -1
      return dir * left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
    })
  }, [filtered, columns, sort])

  const activeCount = filters.filter(conditionComplete).length
  const columnLabels = columns.map((c) => c.label)

  // Show the Score column once any response carries a screening score.
  const scoreById = useMemo(
    () => new Map(liveRows.map((r) => [r.id, r.aiScore ?? null])),
    [liveRows],
  )
  const hasScores = useMemo(() => liveRows.some((r) => r.aiScore != null), [liveRows])

  // Build the detail for the open response (answers + AI fields).
  const openDetail: SubmissionDetail | null = useMemo(() => {
    if (!openId) return null
    const row = liveRows.find((r) => r.id === openId)
    if (!row) return null
    return {
      id: row.id,
      submittedAt: row.submittedAt,
      answers: columns.map((c) => ({ label: c.label, cell: toCell(row.values[c.id], c.type) })),
      aiSummary: row.aiSummary ?? null,
      aiScore: row.aiScore ?? null,
      aiScreenReason: row.aiScreenReason ?? null,
    }
  }, [openId, liveRows, columns])

  function confirmDelete() {
    const id = pendingDelete
    if (!id) return
    startDelete(async () => {
      const res = await deleteSubmission(id)
      if (res.success) {
        setDeletedIds((prev) => new Set(prev).add(id))
        setOpenId((cur) => (cur === id ? null : cur))
        showToast("Response deleted", { type: "success" })
      } else {
        showToast(res.error, { type: "error" })
      }
      setPendingDelete(null)
    })
  }

  if (liveRows.length === 0) {
    return (
      <EmptyState
        title="No submissions yet"
        subtitle="Responses will show up here as people fill out your form. Share it to start collecting."
      />
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[250px]">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search responses…"
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
          />
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <FilterIcon />
          Filters
          {activeCount > 0 ? (
            <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </button>
        {/* Server-rendered export: the table below holds only a capped page, so
            exporting what's on screen silently dropped every response past it.
            The route streams the full set straight to the browser. */}
        <a
          href={`/api/forms/${formId}/export`}
          download
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Icon name="download" className="size-4" />
          Export
        </a>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {displayRows.length} of {liveRows.length} {liveRows.length === 1 ? "response" : "responses"}
        {activeCount > 0 || search.trim() ? " (filtered)" : ""}
        {/* The page is capped, so say so rather than presenting it as the total —
            "200 of 200" on a form with 543 responses reads as data loss. */}
        {totalCompleted > liveRows.length
          ? ` · showing the most recent ${liveRows.length} of ${totalCompleted} — export for all`
          : ""}
      </p>

      {displayRows.length === 0 ? (
        <EmptyState
          title="No matching responses"
          subtitle="Try adjusting your search or filters."
        />
      ) : (
        <>
          <SubmissionsTable
            formId={formId}
            columns={columnLabels}
            rows={displayRows}
            onDelete={(id) => setPendingDelete(id)}
            onOpen={(id) => setOpenId(id)}
            showScore={hasScores}
            scoreById={scoreById}
            sort={sort}
            onSort={toggleSort}
          />

          {/* Appending, not paging. The search box and the filters above work
              over the rows already loaded, so replacing them would leave a
              search quietly looking at a different set than the one it was
              typed against. */}
          {cursor ? (
            <div className="mt-3 flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={isLoadingMore} onClick={loadMore}>
                {isLoadingMore ? "Loading…" : "Load more"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Showing {liveRows.length} of {totalCompleted}
              </span>
            </div>
          ) : null}
        </>
      )}

      <SubmissionDetailSheet
        detail={openDetail}
        open={openId !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null)
        }}
        intelligenceEnabled={intelligenceEnabled}
        onDelete={(id) => setPendingDelete(id)}
      />

      <SubmissionsFilterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        columns={columns}
        filters={filters}
        match={match}
        onChange={(f, m) => {
          setFilters(f)
          setMatch(m)
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this response?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the response and its answers. If it was synced to a
              Google Sheet, its row is removed there too. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={isDeleting}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {isDeleting ? "Deleting…" : "Delete response"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-20 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon name="folder" className="size-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  )
}

