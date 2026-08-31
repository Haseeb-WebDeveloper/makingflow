"use client"

import type { AiField, AiFieldType } from "@/lib/ai/form-schema"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type PartialField = Partial<AiField>
export type PartialForm = {
  title?: string
  description?: string
  fields?: (PartialField | undefined)[]
}

/** Renders the (possibly partial) AI form spec — updates live as it streams. */
export function FormPreview({
  form,
  building,
}: {
  form?: PartialForm
  building?: boolean
}) {
  const fields = (form?.fields ?? []).filter(Boolean) as PartialField[]
  const hasContent = Boolean(form?.title) || fields.length > 0

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {form?.title || (building ? "Building…" : "Your form")}
        </h1>
        {form?.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{form.description}</p>
        ) : null}
      </header>

      <div className="space-y-6">
        {fields.map((field, i) => (
          <FieldBlock key={i} field={field} />
        ))}
        {building ? <BuildingRow /> : null}
      </div>

      {hasContent && !building ? (
        <button
          type="button"
          className="mt-9 inline-flex h-11 items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background"
          tabIndex={-1}
        >
          Submit
        </button>
      ) : null}
    </div>
  )
}

function FieldBlock({ field }: { field: PartialField }) {
  const { type, label, description, required } = field
  if (!type) return null

  if (type === "heading") {
    return (
      <h2 className="pt-2 text-lg font-semibold text-foreground">
        {label || "Section"}
      </h2>
    )
  }
  if (type === "paragraph") {
    return <p className="text-sm leading-relaxed text-muted-foreground">{label}</p>
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        {label || "Question"}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {description ? (
        <p className="-mt-1 text-xs text-muted-foreground">{description}</p>
      ) : null}
      <Control field={field} />
    </div>
  )
}

function Control({ field }: { field: PartialField }) {
  const { type, placeholder, options } = field
  const opts = (options ?? []).filter(Boolean) as string[]

  switch (type as AiFieldType) {
    case "long_text":
      return <Textarea placeholder={placeholder} rows={3} disabled className="resize-none bg-background" />

    case "email":
    case "phone":
    case "url":
    case "short_text":
      return (
        <Input
          type={type === "email" ? "email" : type === "url" ? "url" : type === "phone" ? "tel" : "text"}
          placeholder={placeholder ?? placeholderFor(type)}
          disabled
          className="h-11 bg-background"
        />
      )

    case "date":
      return <Input type="date" disabled className="h-11 bg-background" />
    case "time":
      return <Input type="time" disabled className="h-11 bg-background" />

    case "file_upload":
      return (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          Drop a file or click to upload
        </div>
      )

    case "yes_no":
      return (
        <div className="flex gap-2">
          {["Yes", "No"].map((o) => (
            <span
              key={o}
              className="inline-flex h-10 items-center rounded-md border border-border px-5 text-sm text-foreground"
            >
              {o}
            </span>
          ))}
        </div>
      )

    case "dropdown":
      return (
        <div className="flex h-11 items-center justify-between rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
          {opts[0] ?? "Select an option"}
          <span aria-hidden>▾</span>
        </div>
      )

    case "multiple_choice":
      return <ChoiceList options={opts} shape="circle" />
    case "checkboxes":
    case "multi_select":
      return <ChoiceList options={opts} shape="square" />

    case "rating":
      return <IconRow count={5} kind="star" />
    case "scale":
      return <ScaleRow from={1} to={5} />
    case "nps":
      return <ScaleRow from={0} to={10} />

    default:
      return <Input disabled className="h-11 bg-background" />
  }
}

function ChoiceList({ options, shape }: { options: string[]; shape: "circle" | "square" }) {
  const items = options.length ? options : ["Option one", "Option two"]
  return (
    <div className="space-y-2">
      {items.map((o, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm text-foreground"
        >
          <span
            className={cn(
              "size-4 shrink-0 border border-muted-foreground/50",
              shape === "circle" ? "rounded-full" : "rounded-[4px]",
            )}
          />
          {o}
        </div>
      ))}
    </div>
  )
}

function ScaleRow({ from, to }: { from: number; to: number }) {
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  return (
    <div className="flex flex-wrap gap-1.5">
      {nums.map((n) => (
        <span
          key={n}
          className="inline-flex size-9 items-center justify-center rounded-md border border-border text-sm text-foreground"
        >
          {n}
        </span>
      ))}
    </div>
  )
}

function IconRow({ count }: { count: number; kind: "star" }) {
  return (
    <div className="flex gap-1.5 text-muted-foreground/50">
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} className="size-7" />
      ))}
    </div>
  )
}

function Star({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3.5z" />
    </svg>
  )
}

/** Streaming placeholder row shown while the next field is still arriving. */
function BuildingRow() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    </div>
  )
}

function placeholderFor(type?: string): string {
  switch (type) {
    case "email":
      return "you@company.com"
    case "phone":
      return "+1 555 000 0000"
    case "url":
      return "https://"
    default:
      return "Type your answer…"
  }
}
