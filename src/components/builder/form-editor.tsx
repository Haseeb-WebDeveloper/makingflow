"use client"

import { useRef, useState } from "react"
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
import { uploadToCloudinary } from "@/lib/cloudinary/upload"
import { showToast } from "@/components/ui/toast"
import { SuccessPageEditor, type SuccessPage } from "@/components/builder/success-page-editor"
import { InlineRichText } from "@/components/builder/inline-rich-text"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type BuilderTheme = { logoUrl?: string; coverImageUrl?: string }

// The placeholder-capable field types (whose runtime control renders a free-text
// placeholder — see `Control` in field-control.tsx) get an editable placeholder
// in the canvas preview, with this type-appropriate ghost text until the author
// sets their own (so a Link field doesn't say "Short answer").
const PLACEHOLDER_HINT: Partial<Record<AiFieldType, string>> = {
  short_text: "Short answer",
  long_text: "Long answer",
  email: "name@example.com",
  url: "https://example.com",
  phone: "Phone number",
}

export function FormEditor({
  form,
  onChange,
  theme,
  onThemeChange,
  successPage,
  onSuccessPageChange,
}: {
  form: EditorForm
  onChange: (next: EditorForm) => void
  /** Branding (logo/banner) shown at the top of the canvas — edit mode only. */
  theme?: BuilderTheme
  onThemeChange?: (next: BuilderTheme) => void
  /** Post-submit success page — edit mode only. */
  successPage?: SuccessPage
  onSuccessPageChange?: (next: SuccessPage) => void
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
    <div className="mx-auto w-full max-w-2xl">
      {onThemeChange ? (
        <BrandingHeader theme={theme ?? {}} onChange={onThemeChange} />
      ) : null}

      <textarea
        rows={1}
        value={form.title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Form title"
        className="field-sizing-content mb-8 w-full resize-none border-0 bg-transparent py-0 pr-0 font-sebenta text-3xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
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
        className="mt-2 flex w-full items-center gap-2 rounded-lg py-3 border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
      >
        <Plus className="size-4" />
        Add a block
      </button>

      <div className="mt-8">
        <span className="inline-flex h-11 items-center rounded-md bg-foreground px-6 text-sm font-medium text-background">
          Submit
        </span>
      </div>

      {onSuccessPageChange && successPage ? (
        <SuccessPageEditor value={successPage} onChange={onSuccessPageChange} />
      ) : null}

      <InsertPalette open={paletteOpen} onOpenChange={setPaletteOpen} onPick={insertField} />
    </div>
  )
}

/** Editable banner + logo at the top of the canvas (Cloudinary-backed). */
function BrandingHeader({
  theme,
  onChange,
}: {
  theme: BuilderTheme
  onChange: (next: BuilderTheme) => void
}) {
  const [busy, setBusy] = useState<"logo" | "banner" | null>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  async function pick(kind: "logo" | "banner", file?: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", { type: "error" })
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("That image is too large (max 8MB).", { type: "error" })
      return
    }
    setBusy(kind)
    try {
      const r = await uploadToCloudinary(file, "formAssets")
      onChange({ ...theme, [kind === "logo" ? "logoUrl" : "coverImageUrl"]: r.secureUrl })
    } catch {
      showToast("Couldn't upload that image. Please try again.", { type: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-6">
      {theme.coverImageUrl ? (
        <div className="group relative mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={theme.coverImageUrl}
            alt=""
            className="h-32 w-full rounded-xl border border-border object-cover sm:h-44"
          />
          <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <OverlayButton onClick={() => bannerRef.current?.click()} disabled={busy === "banner"}>
              {busy === "banner" ? "Uploading…" : "Replace"}
            </OverlayButton>
            <OverlayButton onClick={() => onChange({ ...theme, coverImageUrl: undefined })}>
              Remove
            </OverlayButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => bannerRef.current?.click()}
          disabled={busy === "banner"}
          className="mb-4 flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          {busy === "banner" ? (
            "Uploading…"
          ) : (
            <>
              <Plus className="size-4" />
              Add banner
            </>
          )}
        </button>
      )}

      <div>
        {theme.logoUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme.logoUrl}
              alt=""
              className="h-14 w-auto rounded-md border border-border object-contain"
            />
            <button
              type="button"
              onClick={() => logoRef.current?.click()}
              disabled={busy === "logo"}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              {busy === "logo" ? "Uploading…" : "Replace"}
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...theme, logoUrl: undefined })}
              className="text-sm font-medium text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => logoRef.current?.click()}
            disabled={busy === "logo"}
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {busy === "logo" ? (
              "Uploading…"
            ) : (
              <>
                <Plus className="size-4" />
                Add logo
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={bannerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          void pick("banner", f)
        }}
      />
      <input
        ref={logoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          void pick("logo", f)
        }}
      />
    </div>
  )
}

function OverlayButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-background disabled:opacity-60"
    >
      {children}
    </button>
  )
}

/** Image content block editor: upload to Cloudinary, preview, replace/remove. */
function ImageBlockEditor({
  url,
  onUrl,
}: {
  url?: string
  onUrl: (url: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function pick(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", { type: "error" })
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("That image is too large (max 8MB).", { type: "error" })
      return
    }
    setBusy(true)
    try {
      const r = await uploadToCloudinary(file, "formAssets")
      onUrl(r.secureUrl)
    } catch {
      showToast("Couldn't upload that image. Please try again.", { type: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {url ? (
        <div className="group/img relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="w-full rounded-lg border border-border object-cover"
          />
          <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover/img:opacity-100">
            <OverlayButton onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Uploading…" : "Replace"}
            </OverlayButton>
            <OverlayButton onClick={() => onUrl("")}>Remove</OverlayButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex h-28 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          {busy ? (
            "Uploading…"
          ) : (
            <>
              <Plus className="size-4" />
              Add image
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          void pick(f)
        }}
      />
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
  const isContentBlock =
    field.type === "heading" ||
    field.type === "paragraph" ||
    field.type === "image"
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
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onInsertAfter()
              }}
            >
              <Plus className="size-4" />
              Insert block below
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
              <Flow className="size-4" />
              Conditional logic
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
              <Trash className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("rounded-lg py-2.5 pl-9 pr-2 transition-colors", active ? "bg-muted/50" : "hover:bg-muted/30")}>
        {field.type === "page_break" ? (
          <div className="flex items-center gap-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 border-t border-dashed border-border" />
            Page break
            <span className="h-px flex-1 border-t border-dashed border-border" />
          </div>
        ) : field.type === "heading" ? (
          <InlineRichText
            variant="heading"
            value={field.label}
            onChange={(label) => onChange({ label })}
            placeholder={field.config?.headingLevel === "h1" ? "Heading" : "Subheading"}
            className={cn(
              "font-sebenta font-semibold text-foreground",
              field.config?.headingLevel === "h1" ? "text-2xl font-bold tracking-tight" : "text-lg",
            )}
          />
        ) : field.type === "paragraph" ? (
          <InlineRichText
            variant="paragraph"
            value={field.label}
            onChange={(label) => onChange({ label })}
            placeholder="Add a line of text…"
            className="text-sm leading-relaxed text-muted-foreground"
          />
        ) : field.type === "image" ? (
          <ImageBlockEditor
            url={field.config?.imageUrl}
            onUrl={(imageUrl) =>
              onChange({ config: { ...field.config, imageUrl: imageUrl || undefined } })
            }
          />
        ) : (
          <>
            <div className="flex items-start gap-1.5">
              <AutoText
                value={field.label}
                onChange={(label) => onChange({ label })}
                placeholder="Question"
                className="w-auto min-w-0 flex-1 text-sm font-medium text-foreground"
              />
              {/* Always-visible required marker — the state otherwise only lives
                  in the ⋯ menu, so a toggle (manual or AI) looked like a no-op. */}
              {field.required ? (
                <span
                  className="mt-0.5 shrink-0 select-none text-sm font-medium text-destructive"
                  title="Required"
                  aria-label="Required"
                >
                  *
                </span>
              ) : null}
            </div>
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
                <ControlPreview field={field} onChange={onChange} />
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

/**
 * Representation of an input field on the editor canvas. For placeholder-capable
 * types the control is editable IN PLACE — typing sets the field's placeholder,
 * and the type-appropriate hint shows as ghost text until then. Everything else
 * is a non-interactive preview.
 */
function ControlPreview({
  field,
  onChange,
}: {
  field: EditorField
  onChange: (patch: Partial<EditorField>) => void
}) {
  const base = "pointer-events-none flex items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground"
  const editBase = "w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-foreground/40"
  const hint = PLACEHOLDER_HINT[field.type] ?? "Short answer"
  const setPlaceholder = (v: string) => onChange({ placeholder: v || undefined })

  switch (field.type) {
    case "long_text":
      return (
        <textarea
          rows={2}
          value={field.placeholder ?? ""}
          placeholder={hint}
          onChange={(e) => setPlaceholder(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={cn(editBase, "thin-scroll resize-none py-2")}
        />
      )
    case "short_text":
    case "email":
    case "url":
    case "phone":
      return (
        <input
          value={field.placeholder ?? ""}
          placeholder={hint}
          onChange={(e) => setPlaceholder(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={cn(editBase, "h-10")}
        />
      )
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
