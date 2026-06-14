"use client"

import { useState } from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { AiFieldType } from "@/lib/ai/form-schema"
import type { FieldConfig } from "@/lib/db/schema"
import {
  type EditorForm,
  type EditorField,
  genId,
  newField,
  isChoice,
} from "@/lib/builder/form-model"
import { FieldGlyph } from "@/components/builder/field-glyph"
import { InsertPalette } from "@/components/builder/insert-palette"
import { LogicEditor, starterLogic } from "@/components/builder/logic-editor"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function FormEditor({
  form,
  onChange,
}: {
  form: EditorForm
  onChange: (next: EditorForm) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [insertAfter, setInsertAfter] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function setTitle(title: string) {
    onChange({ ...form, title })
  }
  function updateField(id: string, patch: Partial<EditorField>) {
    onChange({ ...form, fields: form.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  }
  function removeField(id: string) {
    onChange({ ...form, fields: form.fields.filter((f) => f.id !== id) })
  }
  function duplicateField(id: string) {
    const i = form.fields.findIndex((f) => f.id === id)
    if (i < 0) return
    const src = form.fields[i]
    const copy: EditorField = {
      ...src,
      id: genId(),
      options: src.options?.map((o) => ({ ...o, id: genId() })),
    }
    const fields = [...form.fields]
    fields.splice(i + 1, 0, copy)
    onChange({ ...form, fields })
  }
  function insertField(type: AiFieldType, config?: FieldConfig) {
    const field = newField(type, config)
    const fields = [...form.fields]
    const i = insertAfter ? fields.findIndex((f) => f.id === insertAfter) : -1
    if (i >= 0) fields.splice(i + 1, 0, field)
    else fields.push(field)
    onChange({ ...form, fields })
    setActiveId(field.id)
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = form.fields.findIndex((f) => f.id === active.id)
    const to = form.fields.findIndex((f) => f.id === over.id)
    if (from < 0 || to < 0) return
    onChange({ ...form, fields: arrayMove(form.fields, from, to) })
  }

  function openPalette(afterId: string | null) {
    setInsertAfter(afterId)
    setPaletteOpen(true)
  }

  return (
    <div className="mx-auto w-full max-w-2xl lg:max-w-[46.667vw]">
      <textarea
        rows={1}
        value={form.title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Form title"
        className="field-sizing-content mb-8 lg:mb-[2.222vw] w-full resize-none border-0 bg-transparent py-0 pl-9 lg:pl-[2.5vw] pr-0 font-sebenta text-3xl lg:text-[2.083vw] font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
      />

      <DndContext id="form-editor-dnd" sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={form.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 lg:space-y-[0.278vw]">
            {form.fields.map((field) => (
              <Block
                key={field.id}
                field={field}
                fields={form.fields}
                active={activeId === field.id}
                onActivate={() => setActiveId(field.id)}
                onChange={(patch) => updateField(field.id, patch)}
                onRemove={() => removeField(field.id)}
                onDuplicate={() => duplicateField(field.id)}
                onInsertAfter={() => openPalette(field.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Insert row */}
      <button
        type="button"
        onClick={() => openPalette(null)}
        className="mt-2 lg:mt-[0.556vw] flex w-full items-center gap-2 lg:gap-[0.556vw] rounded-lg lg:rounded-[0.694vw] py-3 lg:py-[0.833vw] pl-9 lg:pl-[2.5vw] pr-2 lg:pr-[0.556vw] text-sm lg:text-[0.972vw] text-muted-foreground transition-colors hover:bg-muted/60"
      >
        <Plus className="size-4 lg:size-[1.111vw]" />
        Add a block
      </button>

      <div className="mt-8 lg:mt-[2.222vw] pl-9 lg:pl-[2.5vw]">
        <span className="inline-flex h-11 lg:h-[3.056vw] items-center rounded-md lg:rounded-[0.556vw] bg-foreground px-6 lg:px-[1.667vw] text-sm lg:text-[0.972vw] font-medium text-background">
          Submit
        </span>
      </div>

      <InsertPalette open={paletteOpen} onOpenChange={setPaletteOpen} onPick={insertField} />
    </div>
  )
}

function Block({
  field,
  fields,
  active,
  onActivate,
  onChange,
  onRemove,
  onDuplicate,
  onInsertAfter,
}: {
  field: EditorField
  fields: EditorField[]
  active: boolean
  onActivate: () => void
  onChange: (patch: Partial<EditorField>) => void
  onRemove: () => void
  onDuplicate: () => void
  onInsertAfter: () => void
}) {
  const isContentBlock = field.type === "heading" || field.type === "paragraph"
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: field.id })

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group relative", isDragging && "z-10 opacity-80")}
      onClick={onActivate}
    >
      {/* Gutter (inside the block, so it never overflows a narrow panel) */}
      <div className="absolute left-0 top-2 lg:top-[0.556vw] z-10 flex flex-col items-center gap-0.5 lg:gap-[0.139vw] opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="grid size-6 lg:size-[1.667vw] cursor-grab place-items-center rounded lg:rounded-[0.324vw] text-muted-foreground hover:bg-muted active:cursor-grabbing"
        >
          <Grip className="size-4 lg:size-[1.111vw]" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onInsertAfter()
          }}
          aria-label="Insert block below"
          className="grid size-6 lg:size-[1.667vw] place-items-center rounded lg:rounded-[0.324vw] text-muted-foreground hover:bg-muted"
        >
          <Plus className="size-4 lg:size-[1.111vw]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="Block options"
              className="grid size-6 lg:size-[1.667vw] place-items-center rounded lg:rounded-[0.324vw] text-muted-foreground hover:bg-muted"
            >
              <More className="size-4 lg:size-[1.111vw]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-52 lg:w-[14.444vw]">
            {!isContentBlock ? (
              <DropdownMenuCheckboxItem
                checked={field.required}
                onCheckedChange={(v) => onChange({ required: v })}
                onSelect={(e) => e.preventDefault()}
              >
                Required
              </DropdownMenuCheckboxItem>
            ) : null}
            {field.type === "heading" ? (
              <>
                <DropdownMenuCheckboxItem
                  checked={field.config?.headingLevel === "h1"}
                  onCheckedChange={() =>
                    onChange({ config: { ...field.config, headingLevel: "h1" } })
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  Large heading
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={field.config?.headingLevel !== "h1"}
                  onCheckedChange={() =>
                    onChange({ config: { ...field.config, headingLevel: "h2" } })
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  Small heading
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                if (!field.logic) onChange({ logic: starterLogic() })
              }}
            >
              <Flow className="size-4 lg:size-[1.111vw]" />
              Conditional logic
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-4 lg:size-[1.111vw]" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
              <Trash className="size-4 lg:size-[1.111vw]" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("rounded-lg lg:rounded-[0.694vw] py-2.5 lg:py-[0.694vw] pl-9 lg:pl-[2.5vw] pr-2 lg:pr-[0.556vw] transition-colors", active ? "bg-muted/50" : "hover:bg-muted/30")}>
        {field.type === "page_break" ? (
          <div className="flex items-center gap-3 lg:gap-[0.833vw] py-1 lg:py-[0.278vw] text-xs lg:text-[0.833vw] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 border-t border-dashed border-border" />
            Page break
            <span className="h-px flex-1 border-t border-dashed border-border" />
          </div>
        ) : field.type === "heading" ? (
          <AutoText
            value={field.label}
            onChange={(label) => onChange({ label })}
            placeholder={field.config?.headingLevel === "h1" ? "Heading" : "Subheading"}
            className={cn(
              "font-sebenta font-semibold text-foreground",
              field.config?.headingLevel === "h1" ? "text-2xl lg:text-[1.667vw] font-bold tracking-tight" : "text-lg",
            )}
          />
        ) : field.type === "paragraph" ? (
          <AutoText
            value={field.label}
            onChange={(label) => onChange({ label })}
            placeholder="Add a line of text…"
            className="text-sm lg:text-[0.972vw] leading-relaxed text-muted-foreground"
          />
        ) : (
          <>
            <AutoText
              value={field.label}
              onChange={(label) => onChange({ label })}
              placeholder="Question"
              className="text-sm lg:text-[0.972vw] font-medium text-foreground"
            />
            {active || field.description ? (
              <AutoText
                value={field.description ?? ""}
                onChange={(description) => onChange({ description: description || undefined })}
                placeholder="Add a description (optional)"
                className="mt-1 lg:mt-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground"
              />
            ) : null}

            <div className="mt-2.5 lg:mt-[0.694vw]">
              {isChoice(field.type) ? (
                <OptionEditor field={field} onChange={onChange} />
              ) : (
                <ControlPreview field={field} />
              )}
            </div>
          </>
        )}

        {field.logic ? (
          <LogicEditor field={field} fields={fields} onChange={(logic) => onChange({ logic })} />
        ) : null}
      </div>
    </div>
  )
}

function OptionEditor({
  field,
  onChange,
}: {
  field: EditorField
  onChange: (patch: Partial<EditorField>) => void
}) {
  const options = field.options ?? []
  const marker =
    field.type === "multiple_choice"
      ? "rounded-full"
      : field.type === "checkboxes" || field.type === "multi_select"
        ? "rounded-[4px] lg:rounded-[0.278vw]"
        : "rounded-full"

  function setOpt(id: string, label: string) {
    onChange({ options: options.map((o) => (o.id === id ? { ...o, label } : o)) })
  }
  function addOpt() {
    onChange({ options: [...options, { id: genId(), label: `Option ${options.length + 1}` }] })
  }
  function removeOpt(id: string) {
    onChange({ options: options.filter((o) => o.id !== id) })
  }

  return (
    <div className="space-y-1.5 lg:space-y-[0.417vw]">
      {options.map((o, i) => (
        <div key={o.id} className="group/opt flex items-center gap-2.5 lg:gap-[0.694vw]">
          <span className={cn("size-4 lg:size-[1.111vw] shrink-0 border border-muted-foreground/40", marker)} />
          <input
            value={o.label}
            onChange={(e) => setOpt(o.id, e.target.value)}
            placeholder={`Option ${i + 1}`}
            className="flex-1 border-0 bg-transparent py-1 lg:py-[0.278vw] text-sm lg:text-[0.972vw] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {options.length > 1 ? (
            <button
              type="button"
              onClick={() => removeOpt(o.id)}
              aria-label="Remove option"
              className="grid size-5 lg:size-[1.389vw] place-items-center rounded lg:rounded-[0.324vw] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/opt:opacity-100"
            >
              <X className="size-3.5 lg:size-[0.972vw]" />
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={addOpt}
        className="flex items-center gap-1.5 lg:gap-[0.417vw] py-1 lg:py-[0.278vw] text-xs lg:text-[0.833vw] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-3.5 lg:size-[0.972vw]" />
        Add option
      </button>
    </div>
  )
}

/** Non-interactive representation of an input field on the editor canvas. */
function ControlPreview({ field }: { field: EditorField }) {
  const base = "pointer-events-none flex items-center rounded-md lg:rounded-[0.556vw] border border-input bg-background px-3 lg:px-[0.833vw] text-sm lg:text-[0.972vw] text-muted-foreground"
  switch (field.type) {
    case "long_text":
      return <div className={cn(base, "h-16 lg:h-[4.444vw] items-start py-2 lg:py-[0.556vw]")}>{field.placeholder || "Long answer"}</div>
    case "date":
      return (
        <div className={cn(base, "h-10 lg:h-[2.778vw] justify-between")}>
          Pick a date <FieldGlyph type="date" className="size-4 lg:size-[1.111vw]" />
        </div>
      )
    case "time":
      return (
        <div className={cn(base, "h-10 lg:h-[2.778vw] justify-between")}>
          Pick a time <FieldGlyph type="time" className="size-4 lg:size-[1.111vw]" />
        </div>
      )
    case "yes_no":
      return (
        <div className="flex gap-2 lg:gap-[0.556vw]">
          {["Yes", "No"].map((o) => (
            <span key={o} className="inline-flex h-9 lg:h-[2.5vw] items-center rounded-md lg:rounded-[0.556vw] border border-border px-5 lg:px-[1.389vw] text-sm lg:text-[0.972vw] text-foreground">
              {o}
            </span>
          ))}
        </div>
      )
    case "rating":
      return (
        <div className="flex gap-1.5 lg:gap-[0.417vw] text-muted-foreground/40">
          {Array.from({ length: 5 }, (_, i) => (
            <FieldGlyph key={i} type="rating" className="size-6 lg:size-[1.667vw]" />
          ))}
        </div>
      )
    case "scale":
    case "nps": {
      const from = field.type === "nps" ? 0 : 1
      const to = field.type === "nps" ? 10 : 5
      return (
        <div className="flex flex-wrap gap-1.5 lg:gap-[0.417vw]">
          {Array.from({ length: to - from + 1 }, (_, i) => (
            <span key={i} className="inline-flex size-8 lg:size-[2.222vw] items-center justify-center rounded-md lg:rounded-[0.556vw] border border-border text-xs lg:text-[0.833vw] text-foreground">
              {from + i}
            </span>
          ))}
        </div>
      )
    }
    case "file_upload":
      return <div className="pointer-events-none flex h-16 lg:h-[4.444vw] items-center justify-center rounded-md lg:rounded-[0.556vw] border border-dashed border-border text-sm lg:text-[0.972vw] text-muted-foreground">Upload a file</div>
    default:
      return <div className={cn(base, "h-10 lg:h-[2.778vw]")}>{field.placeholder || "Short answer"}</div>
  }
}

function AutoText({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <textarea
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "field-sizing-content block w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground/50",
        className,
      )}
    />
  )
}

function Plus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function X({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
function More({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  )
}
function Flow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8M8 6h6a2 2 0 012 2v2M8 18h6a2 2 0 002-2v-2" />
    </svg>
  )
}
function Copy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h8" />
    </svg>
  )
}
function Trash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
    </svg>
  )
}
function Grip({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}
