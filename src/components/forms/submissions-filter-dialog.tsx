"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  fieldKind,
  operatorsForType,
  operatorLabel,
  type Filter,
  type FilterColumn,
  type MatchMode,
} from "@/lib/submissions/filter"
import { NO_VALUE_OPERATORS, type Operator } from "@/lib/builder/logic"

export function SubmissionsFilterDialog({
  open,
  onOpenChange,
  columns,
  filters,
  match,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: FilterColumn[]
  filters: Filter[]
  match: MatchMode
  onChange: (filters: Filter[], match: MatchMode) => void
}) {
  const colById = new Map(columns.map((c) => [c.id, c]))

  const update = (next: Filter[]) => onChange(next, match)
  const setRow = (i: number, patch: Partial<Filter>) =>
    update(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const addFilter = () => {
    const col = columns[0]
    if (!col) return
    update([...filters, { fieldId: col.id, operator: operatorsForType(col.type)[0], value: "" }])
  }
  const removeFilter = (i: number) => update(filters.filter((_, idx) => idx !== i))

  const onFieldChange = (i: number, fieldId: string) => {
    const col = colById.get(fieldId)
    const ops = col ? operatorsForType(col.type) : (["contains"] as Operator[])
    setRow(i, { fieldId, operator: ops[0], value: "" })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilterIcon />
            Filters
          </DialogTitle>
        </DialogHeader>

        {filters.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No filters yet. Add one to narrow the responses.
          </p>
        ) : (
          <div className="space-y-2">
            {filters.map((f, i) => {
              const col = colById.get(f.fieldId)
              const kind = col ? fieldKind(col.type) : "text"
              const ops = col ? operatorsForType(col.type) : []
              const noValue = NO_VALUE_OPERATORS.has(f.operator)
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <div className="w-16 shrink-0 text-sm">
                    {i === 0 ? (
                      <span className="px-1 text-muted-foreground">Where</span>
                    ) : (
                      <Select value={match} onValueChange={(v) => onChange(filters, v as MatchMode)}>
                        <SelectTrigger className="h-9 w-16 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">And</SelectItem>
                          <SelectItem value="any">Or</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <Select value={f.fieldId} onValueChange={(v) => onFieldChange(i, v)}>
                    <SelectTrigger className="h-9 min-w-[150px] flex-1 text-sm">
                      <SelectValue placeholder="Field" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label || "Untitled"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={f.operator}
                    onValueChange={(v) => setRow(i, { operator: v as Operator, value: "" })}
                  >
                    <SelectTrigger className="h-9 w-[140px] text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ops.map((op) => (
                        <SelectItem key={op} value={op}>
                          {operatorLabel(op, kind)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {!noValue ? (
                    <ValueEditor
                      column={col}
                      kind={kind}
                      value={typeof f.value === "string" ? f.value : ""}
                      onChange={(v) => setRow(i, { value: v })}
                    />
                  ) : null}

                  <button
                    type="button"
                    onClick={() => removeFilter(i)}
                    aria-label="Remove filter"
                    className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
          <button
            type="button"
            onClick={addFilter}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/80"
          >
            <span className="text-base leading-none">+</span> Add filter
          </button>
          {filters.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([], match)}
              className="text-sm text-muted-foreground transition-colors hover:text-destructive"
            >
              Clear all filters
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ValueEditor({
  column,
  kind,
  value,
  onChange,
}: {
  column: FilterColumn | undefined
  kind: ReturnType<typeof fieldKind>
  value: string
  onChange: (v: string) => void
}) {
  const cls = "h-9 min-w-[130px] flex-1 text-sm"

  if (kind === "single" || kind === "multi") {
    const opts =
      column?.type === "yes_no"
        ? [{ label: "Yes" }, { label: "No" }]
        : (column?.options ?? []).map((o) => ({ label: o.label }))
    if (opts.length > 0) {
      return (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger className={cls}>
            <SelectValue placeholder="Value" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.label} value={o.label}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
  }

  const type =
    kind === "number" ? "number" : column?.type === "date" ? "date" : column?.type === "time" ? "time" : "text"
  return (
    <Input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value"
      className={cls}
    />
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  )
}
