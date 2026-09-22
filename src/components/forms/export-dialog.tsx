"use client"

/**
 * Choosing what to export.
 *
 * SEEDED FROM THE TABLE, which is the whole reason it exists. The old Export
 * button sat next to an active filter chip and exported everything anyway;
 * opening this with the current search and filters already selected is what
 * makes the button mean what it appears to mean.
 *
 * IT DOES NOT DECIDE WHETHER THE EXPORT IS SERVABLE. Only the server knows how
 * many responses the scope holds, and the limit differs by format, so
 * `prepareExport` is asked first and an oversized request arrives as a sentence
 * in the dialog rather than as a 413 the browser renders as a failed download.
 *
 * THE FILES THEMSELVES ARE NOT HERE. This dialog produces the data file; the
 * uploads come from the Files (ZIP) button beside it, because a single click
 * cannot hand a browser two downloads. The spec has `files: "zip"` for the day
 * a queue can email both together.
 */

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { showToast } from "@/components/ui/toast"
import { prepareExport } from "@/lib/actions/exports"
import {
  exportSpecSchema,
  META_COLUMNS,
  type ExportSpec,
  type MetaColumnKey,
} from "@/lib/submissions/export-spec"
import { META_HEADERS } from "@/lib/submissions/export-columns"
import type { Filter, FilterColumn, MatchMode } from "@/lib/submissions/filter"

type Scope = "current" | "all" | "recent"

/** Columns worth offering first — the rest are behind "more". */
const COMMON_META: MetaColumnKey[] = ["submissionId", "started", "status", "aiScore", "aiSummary"]

const FORMAT_HINTS: Record<ExportSpec["format"], string> = {
  csv: "Opens anywhere. Best for large exports.",
  xlsx: "A real Excel workbook, with a frozen header.",
  json: "For feeding another system. Keeps AI follow-ups nested.",
}

export function ExportDialog({
  formId,
  open,
  onOpenChange,
  columns,
  live,
  totalCompleted,
}: {
  formId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: FilterColumn[]
  /** What the responses table is showing right now. */
  live: { search: string; filters: Filter[]; match: MatchMode }
  totalCompleted: number
}) {
  const filtered = live.search.trim().length > 0 || live.filters.length > 0

  const [scope, setScope] = useState<Scope>(filtered ? "current" : "all")
  const [format, setFormat] = useState<ExportSpec["format"]>("csv")
  const [recent, setRecent] = useState(100)
  const [includePartials, setIncludePartials] = useState(false)
  const [meta, setMeta] = useState<MetaColumnKey[]>(["submitted"])
  const [showAllMeta, setShowAllMeta] = useState(false)
  const [allFields, setAllFields] = useState(true)
  const [fields, setFields] = useState<string[]>([])
  const [removedQuestions, setRemovedQuestions] = useState(false)
  const [aiFollowUps, setAiFollowUps] = useState(false)
  const [pending, start] = useTransition()

  // The zone the owner will read the spreadsheet in, not the server's.
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  function toggleMeta(key: MetaColumnKey, on: boolean) {
    setMeta((prev) => {
      const next = on ? [...prev, key] : prev.filter((k) => k !== key)
      // Kept in META_COLUMNS order so the column order does not depend on the
      // order somebody happened to click the boxes in.
      return META_COLUMNS.filter((k) => next.includes(k))
    })
  }

  function buildSpec(): ExportSpec {
    return exportSpecSchema.parse({
      format,
      scope: {
        status: includePartials ? "all" : "completed",
        search: scope === "current" ? live.search : undefined,
        filters: scope === "current" ? live.filters : [],
        match: live.match,
        limit: scope === "recent" ? recent : undefined,
        order: scope === "recent" ? "newest" : "oldest",
      },
      columns: {
        meta,
        fields: allFields ? "all" : fields,
        removedQuestions,
        aiFollowUps,
      },
      // Links in the data file; the archive is its own button.
      files: "urls",
      timezone,
    })
  }

  function submit() {
    start(async () => {
      const res = await prepareExport(formId, buildSpec())
      if (!res.success) {
        showToast(res.error, { type: "error" })
        return
      }
      // A navigation, not a fetch: the browser then honours the filename in
      // Content-Disposition, which a fetch would discard.
      window.location.assign(res.url)
      onOpenChange(false)
    })
  }

  const columnCount =
    meta.length + (allFields ? columns.length : fields.length) + (aiFollowUps ? 2 : 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[min(32rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Export responses</DialogTitle>
          <DialogDescription>
            {filtered
              ? "Your search and filters are already applied below."
              : `${totalCompleted} ${totalCompleted === 1 ? "response" : "responses"} in this form.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55dvh] space-y-5 overflow-y-auto pr-1">
          <Field label="Which responses">
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">The ones I&apos;m looking at</SelectItem>
                <SelectItem value="all">Every response</SelectItem>
                <SelectItem value="recent">Most recent…</SelectItem>
              </SelectContent>
            </Select>
            {scope === "recent" ? (
              <Input
                type="number"
                min={1}
                value={recent}
                onChange={(e) => setRecent(Math.max(1, Number(e.target.value) || 1))}
                className="mt-2 w-28"
                aria-label="How many recent responses"
              />
            ) : null}
            {scope === "current" && !filtered ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No search or filter is active, so this is every response.
              </p>
            ) : null}
            <Toggle
              className="mt-2"
              checked={includePartials}
              onChange={setIncludePartials}
              label="Include unfinished responses"
            />
          </Field>

          <Field label="Format">
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ExportSpec["format"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-muted-foreground">{FORMAT_HINTS[format]}</p>
          </Field>

          <Field label="Questions">
            <Toggle
              checked={allFields}
              onChange={(on) => {
                setAllFields(on)
                if (!on) setFields(columns.map((c) => c.id))
              }}
              label={`Every question (${columns.length})`}
            />
            {!allFields ? (
              <div className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
                {columns.map((c) => (
                  <Toggle
                    key={c.id}
                    checked={fields.includes(c.id)}
                    onChange={(on) =>
                      setFields((prev) =>
                        on
                          ? columns.filter((x) => [...prev, c.id].includes(x.id)).map((x) => x.id)
                          : prev.filter((id) => id !== c.id),
                      )
                    }
                    label={c.label || "Untitled"}
                  />
                ))}
              </div>
            ) : null}
          </Field>

          <Field label="Extra columns">
            <Toggle
              checked={aiFollowUps}
              onChange={setAiFollowUps}
              label="AI follow-up questions and answers"
            />
            <Toggle
              checked={removedQuestions}
              onChange={setRemovedQuestions}
              label="Answers to deleted questions"
            />
            {(showAllMeta ? [...META_COLUMNS] : COMMON_META)
              .filter((key) => key !== "submitted")
              .map((key) => (
                <Toggle
                  key={key}
                  checked={meta.includes(key)}
                  onChange={(on) => toggleMeta(key, on)}
                  label={META_HEADERS[key]}
                />
              ))}
            {!showAllMeta ? (
              <button
                type="button"
                onClick={() => setShowAllMeta(true)}
                className="mt-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Show all columns
              </button>
            ) : null}
          </Field>
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {columnCount} {columnCount === 1 ? "column" : "columns"} · times in {timezone}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              <Icon name="download" className="mr-1.5 size-4" />
              {pending ? "Preparing…" : "Download"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-medium text-foreground">{label}</p>
      {children}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
  className?: string
}) {
  return (
    <label
      className={`flex min-w-0 cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground ${className ?? ""}`}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}
