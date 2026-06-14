"use client"

import { type EditorField, isAnswerable } from "@/lib/builder/form-model"
import type { FieldLogic, FieldCondition } from "@/lib/db/schema"
import { LOGIC_OPERATORS, NO_VALUE_OPERATORS } from "@/lib/builder/logic"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"

export function starterLogic(): FieldLogic {
  return {
    action: "show",
    match: "all",
    conditions: [{ fieldId: "", operator: "equals", value: "" }],
    source: "manual",
  }
}

/** "Show / Hide this field when …" — target-centric rule editor, Tally-style. */
export function LogicEditor({
  field,
  fields,
  onChange,
}: {
  field: EditorField
  fields: EditorField[]
  onChange: (logic: FieldLogic | undefined) => void
}) {
  const logic = field.logic
  if (!logic) return null

  const sources = fields.filter((f) => f.id !== field.id && isAnswerable(f.type))
  const conditions = logic.conditions ?? []

  const setLogic = (patch: Partial<FieldLogic>) => onChange({ ...logic, ...patch })
  const setCondition = (i: number, patch: Partial<FieldCondition>) =>
    setLogic({ conditions: conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) })
  const addCondition = () =>
    setLogic({ conditions: [...conditions, { fieldId: "", operator: "equals", value: "" }] })
  const removeCondition = (i: number) => {
    const next = conditions.filter((_, idx) => idx !== i)
    if (next.length === 0) onChange(undefined)
    else setLogic({ conditions: next })
  }

  return (
    <div
      className="mt-3 lg:mt-[0.833vw] rounded-md lg:rounded-[0.556vw] border border-border bg-background p-3 lg:p-[0.833vw]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2.5 lg:mb-[0.694vw] flex flex-wrap items-center gap-1.5 lg:gap-[0.417vw] text-xs lg:text-[0.833vw] text-muted-foreground">
        <Select value={logic.action} onValueChange={(v) => setLogic({ action: v as "show" | "hide" })}>
          <SelectTrigger className="h-7 lg:h-[1.944vw] w-[74px] lg:w-[5.139vw] text-xs lg:text-[0.833vw]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="show">Show</SelectItem>
            <SelectItem value="hide">Hide</SelectItem>
          </SelectContent>
        </Select>
        <span>this field when</span>
        {conditions.length > 1 ? (
          <Select value={logic.match} onValueChange={(v) => setLogic({ match: v as "all" | "any" })}>
            <SelectTrigger className="h-7 lg:h-[1.944vw] w-[64px] lg:w-[4.444vw] text-xs lg:text-[0.833vw]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all</SelectItem>
              <SelectItem value="any">any</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {conditions.length > 1 ? <span>match</span> : null}
      </div>

      <div className="space-y-2 lg:space-y-[0.556vw]">
        {conditions.map((c, i) => {
          const src = sources.find((s) => s.id === c.fieldId)
          const noValue = NO_VALUE_OPERATORS.has(c.operator)
          const value = typeof c.value === "string" ? c.value : ""
          return (
            <div key={i} className="flex flex-wrap items-center gap-1.5 lg:gap-[0.417vw]">
              <Select value={c.fieldId || undefined} onValueChange={(v) => setCondition(i, { fieldId: v })}>
                <SelectTrigger className="h-8 lg:h-[2.222vw] min-w-[110px] lg:min-w-[7.639vw] flex-1 text-xs lg:text-[0.833vw]">
                  <SelectValue placeholder="Select a field" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s, idx) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label || `Question ${idx + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={c.operator} onValueChange={(v) => setCondition(i, { operator: v as FieldCondition["operator"] })}>
                <SelectTrigger className="h-8 lg:h-[2.222vw] w-[118px] lg:w-[8.194vw] text-xs lg:text-[0.833vw]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOGIC_OPERATORS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!noValue ? (
                src?.options && src.options.length > 0 ? (
                  <Select value={value || undefined} onValueChange={(v) => setCondition(i, { value: v })}>
                    <SelectTrigger className="h-8 lg:h-[2.222vw] min-w-[110px] lg:min-w-[7.639vw] flex-1 text-xs lg:text-[0.833vw]">
                      <SelectValue placeholder="Value" />
                    </SelectTrigger>
                    <SelectContent>
                      {src.options.map((o) => (
                        <SelectItem key={o.id} value={o.label}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={value}
                    onChange={(e) => setCondition(i, { value: e.target.value })}
                    placeholder="Value"
                    className="h-8 lg:h-[2.222vw] min-w-[110px] lg:min-w-[7.639vw] flex-1 text-xs lg:text-[0.833vw]"
                  />
                )
              ) : null}

              <button
                type="button"
                onClick={() => removeCondition(i)}
                aria-label="Remove condition"
                className="grid size-7 lg:size-[1.944vw] shrink-0 place-items-center rounded lg:rounded-[0.324vw] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" className="size-3.5 lg:size-[0.972vw]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 lg:mt-[0.694vw] flex items-center justify-between">
        <button type="button" onClick={addCondition} className="text-xs lg:text-[0.833vw] font-medium text-foreground hover:underline">
          + Add condition
        </button>
        <button type="button" onClick={() => onChange(undefined)} className="text-xs lg:text-[0.833vw] text-muted-foreground transition-colors hover:text-destructive">
          Remove logic
        </button>
      </div>
    </div>
  )
}
