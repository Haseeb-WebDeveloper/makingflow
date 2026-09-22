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
 * rather than as a 413 the browser renders as a failed download.
 *
 * THE COLUMN PICKER STAYS FOLDED AWAY until asked for. Three sections fit
 * without scrolling; twenty checkboxes do not, and the first version put a
 * scrollbar through the middle of a dialog whose defaults are what almost
 * everybody wants. The summary line says what those defaults are, so opening
 * the picker is a choice rather than a thing to read past.
 *
 * THE FILES THEMSELVES ARE NOT HERE. This produces the data file; the uploads
 * come from the Files (ZIP) button beside it, because one click cannot hand a
 * browser two downloads.
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
import { cn } from "@/lib/utils"
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
type Format = ExportSpec["format"]

const FORMATS: { value: Format; label: string; hint: string }[] = [
  { value: "csv", label: "CSV", hint: "Opens anywhere. Best for large exports." },
  { value: "xlsx", label: "Excel", hint: "A real workbook, with a frozen header row." },
  { value: "json", label: "JSON", hint: "For another system. Keeps AI follow-ups nested." },
]

/** Offered first; the rest are behind "Show every column". */
const COMMON_META: MetaColumnKey[] = ["submissionId", "started", "status", "aiScore", "aiSummary"]

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
  const [format, setFormat] = useState<Format>("csv")
  const [recent, setRecent] = useState(100)
  const [includePartials, setIncludePartials] = useState(false)
  const [customising, setCustomising] = useState(false)
  const [meta, setMeta] = useState<MetaColumnKey[]>(["submitted"])
  const [showAllMeta, setShowAllMeta] = useState(false)
  const [allFields, setAllFields] = useState(true)
  const [fields, setFields] = useState<string[]>([])
  const [removedQuestions, setRemovedQuestions] = useState(false)
  const [aiFollowUps, setAiFollowUps] = useState(false)
  const [pending, start] = useTransition()

  // The zone the owner will read the file in, not the server's.
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  function toggleMeta(key: MetaColumnKey, on: boolean) {
    setMeta((prev) => {
      const next = on ? [...prev, key] : prev.filter((k) => k !== key)
      // Held in META_COLUMNS order, so column order never depends on the order
      // somebody happened to tick the boxes.
      return META_COLUMNS.filter((k) => next.includes(k))
    })
  }

  function toggleField(id: string, on: boolean) {
    setFields((prev) => {
      const next = on ? [...prev, id] : prev.filter((f) => f !== id)
      return columns.filter((c) => next.includes(c.id)).map((c) => c.id)
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
      columns: { meta, fields: allFields ? "all" : fields, removedQuestions, aiFollowUps },
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

  const questionCount = allFields ? columns.length : fields.length
  const columnCount = meta.length + questionCount + (aiFollowUps ? 2 : 0)
  const summary = [
    `${questionCount === columns.length ? "All" : questionCount} ${
      questionCount === 1 ? "question" : "questions"
    }`,
    `${meta.length} extra`,
  ].join(" · ")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[min(30rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Export responses</DialogTitle>
          <DialogDescription>
            {totalCompleted} {totalCompleted === 1 ? "response" : "responses"} · times in{" "}
            {timezone}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section>
            <Label>Which responses</Label>
            <div className="flex gap-2">
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger className="h-9 flex-1 text-sm">
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
                  className="h-9 w-24 text-sm"
                  aria-label="How many recent responses"
                />
              ) : null}
            </div>
            {scope === "current" && !filtered ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Nothing is filtered right now, so this is every response.
              </p>
            ) : null}
            <Check
              className="mt-2.5"
              checked={includePartials}
              onChange={setIncludePartials}
              label="Include unfinished responses"
            />
          </section>

          <section>
            <Label>Format</Label>
            {/* A segmented row rather than a dropdown: three choices, all worth
                seeing at once, and it removes a click plus a line of help text
                that only described whichever one was already selected. */}
            <div className="flex rounded-md border border-border p-0.5">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFormat(f.value)}
                  aria-pressed={format === f.value}
                  className={cn(
                    "flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                    format === f.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {FORMATS.find((f) => f.value === format)?.hint}
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <Label className="mb-0">Columns</Label>
              <button
                type="button"
                onClick={() => setCustomising((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {customising ? "Done" : "Customise"}
                <Icon
                  name={customising ? "hide" : "edit"}
                  className="size-3.5"
                />
              </button>
            </div>
            {!customising ? (
              <p className="mt-1.5 text-sm text-muted-foreground">{summary}</p>
            ) : (
              <div className="mt-2 space-y-3">
                <div>
                  <Check
                    checked={allFields}
                    onChange={(on) => {
                      setAllFields(on)
                      // Pre-tick everything when switching to a manual choice,
                      // so unticking one is the small edit it looks like rather
                      // than a blank slate.
                      if (!on) setFields(columns.map((c) => c.id))
                    }}
                    label={`Every question (${columns.length})`}
                  />
                  {!allFields ? (
                    <div className="mt-1.5 max-h-36 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
                      {columns.map((c) => (
                        <Check
                          key={c.id}
                          checked={fields.includes(c.id)}
                          onChange={(on) => toggleField(c.id, on)}
                          label={c.label || "Untitled"}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-0.5 border-t border-border pt-3">
                  <Check
                    checked={aiFollowUps}
                    onChange={setAiFollowUps}
                    label="AI follow-up questions and answers"
                  />
                  <Check
                    checked={removedQuestions}
                    onChange={setRemovedQuestions}
                    label="Answers to deleted questions"
                  />
                  {(showAllMeta ? [...META_COLUMNS] : COMMON_META)
                    .filter((key) => key !== "submitted")
                    .map((key) => (
                      <Check
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
                      className="pt-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Show every column
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {columnCount} {columnCount === 1 ? "column" : "columns"}
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

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("mb-1.5 text-sm font-medium text-foreground", className)}>{children}</p>
  )
}

function Check({
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
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 py-1 text-sm text-foreground",
        className,
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}
