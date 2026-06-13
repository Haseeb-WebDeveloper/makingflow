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
  function insertField(type: AiFieldType) {
    const field = newField(type)
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
    <div className="mx-auto w-full max-w-2xl">
      <textarea
        rows={1}
        value={form.title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Form title"
        className="field-sizing-content mb-8 w-full resize-none border-0 bg-transparent py-0 pl-9 pr-0 font-sebenta text-3xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
      />

      <DndContext id="form-editor-dnd" sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={form.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
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
        className="mt-2 flex w-full items-center gap-2 rounded-lg py-3 pl-9 pr-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
      >
        <Plus className="size-4" />
        Add a block
      </button>

      <div className="mt-8 pl-9">
        <span className="inline-flex h-11 items-center rounded-md bg-foreground px-6 text-sm font-medium text-background">
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
      <div className="absolute left-0 top-2 z-10 flex flex-col items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="grid size-6 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
        >
          <Grip className="size-4" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onInsertAfter()
          }}
          aria-label="Insert block below"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
        >
          <Plus className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="Block options"
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
            >
              <More className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-52">
            {!isContentBlock ? (
              <DropdownMenuCheckboxItem
                checked={field.required}
                onCheckedChange={(v) => onChange({ required: v })}
                onSelect={(e) => e.preventDefault()}
              >
                Required
              </DropdownMenuCheckboxItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                if (!field.logic) onChange({ logic: starterLogic() })
              }}
            >
              <Flow className="size-4" />
              Conditional logic
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("rounded-lg py-2.5 pl-9 pr-2 transition-colors", active ? "bg-muted/50" : "hover:bg-muted/30")}>
        {field.type === "heading" ? (
          <AutoText
            value={field.label}
            onChange={(label) => onChange({ label })}
            placeholder="Heading"
            className="font-sebenta text-lg font-semibold text-foreground"
          />
        ) : field.type === "paragraph" ? (
          <AutoText
            value={field.label}
            onChange={(label) => onChange({ label })}
            placeholder="Add a line of text…"
            className="text-sm leading-relaxed text-muted-foreground"
          />
        ) : (
          <>
            <AutoText
              value={field.label}
              onChange={(label) => onChange({ label })}
              placeholder="Question"
              className="text-sm font-medium text-foreground"
            />
            {active || field.description ? (
              <AutoText
                value={field.description ?? ""}
                onChange={(description) => onChange({ description: description || undefined })}
                placeholder="Add a description (optional)"
                className="mt-1 text-xs text-muted-foreground"
              />
            ) : null}

            <div className="mt-2.5">
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
        ? "rounded-[4px]"
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
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={o.id} className="group/opt flex items-center gap-2.5">
          <span className={cn("size-4 shrink-0 border border-muted-foreground/40", marker)} />
          <input
            value={o.label}
            onChange={(e) => setOpt(o.id, e.target.value)}
            placeholder={`Option ${i + 1}`}
            className="flex-1 border-0 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {options.length > 1 ? (
            <button
              type="button"
              onClick={() => removeOpt(o.id)}
              aria-label="Remove option"
              className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/opt:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={addOpt}
        className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add option
      </button>
    </div>
  )
}

/** Non-interactive representation of an input field on the editor canvas. */
function ControlPreview({ field }: { field: EditorField }) {
  const base = "pointer-events-none flex items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground"
  switch (field.type) {
    case "long_text":
      return <div className={cn(base, "h-16 items-start py-2")}>{field.placeholder || "Long answer"}</div>
    case "date":
      return (
        <div className={cn(base, "h-10 justify-between")}>
          Pick a date <FieldGlyph type="date" className="size-4" />
        </div>
      )
    case "time":
      return (
        <div className={cn(base, "h-10 justify-between")}>
          Pick a time <FieldGlyph type="time" className="size-4" />
        </div>
      )
    case "yes_no":
      return (
        <div className="flex gap-2">
          {["Yes", "No"].map((o) => (
            <span key={o} className="inline-flex h-9 items-center rounded-md border border-border px-5 text-sm text-foreground">
              {o}
            </span>
          ))}
        </div>
      )
    case "rating":
      return (
        <div className="flex gap-1.5 text-muted-foreground/40">
          {Array.from({ length: 5 }, (_, i) => (
            <FieldGlyph key={i} type="rating" className="size-6" />
          ))}
        </div>
      )
    case "scale":
    case "nps": {
      const from = field.type === "nps" ? 0 : 1
      const to = field.type === "nps" ? 10 : 5
      return (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: to - from + 1 }, (_, i) => (
            <span key={i} className="inline-flex size-8 items-center justify-center rounded-md border border-border text-xs text-foreground">
              {from + i}
            </span>
          ))}
        </div>
      )
    }
    case "file_upload":
      return <div className="pointer-events-none flex h-16 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">Upload a file</div>
    default:
      return <div className={cn(base, "h-10")}>{field.placeholder || "Short answer"}</div>
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
