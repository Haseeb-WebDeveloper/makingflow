"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { format, parse } from "date-fns"
import type { PublicField, PublicTheme } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"
import { uploadToCloudinary } from "@/lib/cloudinary/upload"
import { showToast } from "@/components/ui/toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Rating } from "@/components/reui/rating"
import { cn } from "@/lib/utils"

// Code-split the heavy, type-specific controls so a respondent only downloads
// them when the form actually has that field. `PhoneInput` pulls
// react-phone-number-input + every country flag (~100KB); `Calendar` pulls
// react-day-picker. Most forms have neither.
// A `loading` fallback keeps the lazy load contained to its OWN local Suspense
// boundary. Without it, the first-render suspension bubbles up to the route's
// loading.tsx — so opening the date picker flashed the whole-form skeleton.
const PhoneInput = dynamic(
  () => import("@/components/reui/phone-input").then((m) => m.PhoneInput),
  { loading: () => <div className="h-9 w-full animate-pulse rounded-md border border-input bg-muted/30" /> },
)
const Calendar = dynamic(
  () => import("@/components/ui/calendar").then((m) => m.Calendar),
  { loading: () => <div className="h-[19rem] w-60 animate-pulse rounded-md bg-muted/30" /> },
)

export type UploadedFile = {
  storageKey: string
  url: string
  name: string
  mime: string
  bytes: number
}

/**
 * Shared field renderers for both runtimes. The classic `FormRuntime` renders
 * `Field` (label + control); the conversational runtime renders `Control`
 * directly (as inline pills/inputs in the chat thread) and reuses it again for
 * the graceful-degradation fallback when the AI layer is unavailable.
 */
export function Field({
  field,
  value,
  error,
  onChange,
  testMode,
}: {
  field: PublicField
  value: AnswerValue | undefined
  error?: string
  onChange: (v: AnswerValue) => void
  testMode?: boolean
}) {
  if (field.type === "heading") {
    return field.config?.headingLevel === "h1" ? (
      <h2 className="pt-2 font-sebenta text-2xl font-bold tracking-tight text-foreground">{field.label}</h2>
    ) : (
      <h3 className="pt-2 font-sebenta text-lg font-semibold text-foreground">{field.label}</h3>
    )
  }
  if (field.type === "paragraph") {
    return <p className="text-sm leading-relaxed text-muted-foreground">{field.label}</p>
  }

  return (
    <div id={`field-${field.id}`} className="space-y-2">
      <label className="block text-sm font-medium text-foreground">
        {field.label}
        {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {field.description ? (
        <p className="-mt-1 text-xs text-muted-foreground">{field.description}</p>
      ) : null}
      <Control field={field} value={value} invalid={!!error} onChange={onChange} testMode={testMode} />
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Form-level branding (banner + logo) shown above the title in both runtimes. */
/**
 * Inject Cloudinary delivery transforms (auto format/quality + a size cap) into
 * an upload URL so respondents download a small, modern (WebP/AVIF) image instead
 * of the full-resolution original. No-ops on non-Cloudinary URLs.
 */
function cldDeliver(url: string, transform: string): string {
  const marker = "/image/upload/"
  const i = url.indexOf(marker)
  if (i === -1) return url
  return `${url.slice(0, i + marker.length)}${transform}/${url.slice(i + marker.length)}`
}

export function FormBranding({ theme }: { theme?: PublicTheme | null }) {
  if (!theme || (!theme.logoUrl && !theme.coverImageUrl)) return null
  return (
    <div className="mb-6">
      {theme.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cldDeliver(theme.coverImageUrl, "f_auto,q_auto,w_1400,c_limit")}
          alt=""
          decoding="async"
          className="mb-4 h-32 w-full rounded-xl object-cover sm:h-44"
        />
      ) : null}
      {theme.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cldDeliver(theme.logoUrl, "f_auto,q_auto,h_160,c_limit")}
          alt=""
          decoding="async"
          loading="lazy"
          className="h-12 w-auto object-contain sm:h-14 rounded-md"
        />
      ) : null}
    </div>
  )
}

export const inputBase =
  "h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/40"

export function Control({
  field,
  value,
  invalid,
  onChange,
  testMode,
}: {
  field: PublicField
  value: AnswerValue | undefined
  invalid: boolean
  onChange: (v: AnswerValue) => void
  testMode?: boolean
}) {
  const opts = field.options ?? []
  const border = invalid ? "border-destructive" : "border-input"
  const str = typeof value === "string" ? value : ""
  const arr = Array.isArray(value) ? (value as string[]) : []

  switch (field.type) {
    case "long_text":
      return (
        <textarea
          rows={4}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn("thin-scroll w-full resize-none rounded-md border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40", border)}
        />
      )

    case "phone":
      return (
        <PhoneInput
          value={str}
          placeholder={field.placeholder}
          aria-invalid={invalid || undefined}
          onChange={(v) => onChange((v ?? "") as string)}
          className="w-full"
        />
      )

    case "email":
    case "url":
    case "short_text":
      return (
        <input
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputBase, border)}
        />
      )

    case "date":
      return <DateControl value={str} invalid={invalid} onChange={onChange} />
    case "time":
      return <input type="time" value={str} onChange={(e) => onChange(e.target.value)} className={cn(inputBase, border)} />

    case "dropdown":
      return (
        <Select value={str || undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger aria-invalid={invalid || undefined} className="h-11 w-full bg-background">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.id} value={o.label}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case "yes_no":
      return (
        <div className="flex gap-2">
          {["Yes", "No"].map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={cn(
                "h-10 rounded-md border px-6 text-sm transition-colors",
                str === o ? "border-foreground bg-foreground text-background" : cn(border, "text-foreground hover:bg-muted"),
              )}
            >
              {o}
            </button>
          ))}
        </div>
      )

    case "multiple_choice":
      return (
        <div className="space-y-2">
          {opts.map((o) => {
            const selected = str === o.label
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onChange(o.label)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                  selected ? "border-foreground bg-muted" : cn(border, "hover:bg-muted"),
                )}
              >
                <span className={cn("size-4 shrink-0 rounded-full border", selected ? "border-[5px] border-foreground" : "border-muted-foreground/50")} />
                {o.label}
              </button>
            )
          })}
        </div>
      )

    case "checkboxes":
    case "multi_select":
      return (
        <div className="space-y-2">
          {opts.map((o) => {
            const checked = arr.includes(o.label)
            return (
              <label
                key={o.id}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                  checked ? "border-foreground bg-muted" : cn(border, "hover:bg-muted"),
                )}
              >
                <Checkbox
                  checked={checked}
                  aria-invalid={invalid || undefined}
                  onCheckedChange={(c) =>
                    onChange(c ? [...arr, o.label] : arr.filter((v) => v !== o.label))
                  }
                />
                {o.label}
              </label>
            )
          })}
        </div>
      )

    case "rating": {
      const current = typeof value === "number" ? value : 0
      const max = Math.max(1, field.config?.ratingMax ?? 5)
      return (
        <Rating
          rating={current}
          maxRating={max}
          size="lg"
          editable
          onRatingChange={(n) => onChange(n)}
        />
      )
    }

    case "scale": {
      const min = field.config?.min ?? 1
      const max = field.config?.max ?? 5
      const step = field.config?.step ?? 1
      const current = typeof value === "number" ? value : null
      return (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-4">
            <Slider
              value={[current ?? min]}
              min={min}
              max={max}
              step={step}
              onValueChange={([v]) => onChange(v)}
              className="flex-1"
            />
            <span className="w-8 shrink-0 text-right text-sm font-medium text-foreground">
              {current ?? "—"}
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{field.config?.minLabel || min}</span>
            <span>{field.config?.maxLabel || max}</span>
          </div>
        </div>
      )
    }

    case "nps": {
      const current = typeof value === "number" ? value : null
      const nums = Array.from({ length: 11 }, (_, i) => i)
      return (
        <div className="flex flex-wrap gap-1.5">
          {nums.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-md border text-sm transition-colors",
                current === n ? "border-foreground bg-foreground text-background" : cn(border, "text-foreground hover:bg-muted"),
              )}
            >
              {n}
            </button>
          ))}
        </div>
      )
    }

    case "file_upload":
      return <FileControl field={field} value={value} invalid={invalid} onChange={onChange} testMode={testMode} />


    default:
      return (
        <input value={str} onChange={(e) => onChange(e.target.value)} className={cn(inputBase, border)} />
      )
  }
}

/** Single-date picker: a styled trigger opening a calendar popover. Stores the
 *  value as an ISO `yyyy-MM-dd` string (unchanged from the old native input). */
function DateControl({
  value,
  invalid,
  onChange,
}: {
  value: string
  invalid: boolean
  onChange: (v: AnswerValue) => void
}) {
  const [open, setOpen] = useState(false)
  const parsed = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined
  const valid = parsed && !isNaN(parsed.getTime())

  // Warm the calendar chunk as soon as a date field is on screen, so the first
  // click opens the picker instantly instead of showing a loading state.
  useEffect(() => {
    void import("@/components/ui/calendar")
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          inputBase,
          invalid ? "border-destructive" : "border-input",
          "flex items-center justify-between gap-2 text-left",
          !valid && "text-muted-foreground",
        )}
      >
        <span>{valid ? format(parsed as Date, "PPP") : "Select a date"}</span>
        <CalendarGlyph className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto" initialFocus={false}>
        <Calendar
          mode="single"
          selected={valid ? parsed : undefined}
          defaultMonth={valid ? parsed : undefined}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : "")
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </svg>
  )
}

function FileControl({
  field,
  value,
  invalid,
  onChange,
  testMode,
}: {
  field: PublicField
  value: AnswerValue | undefined
  invalid: boolean
  onChange: (v: AnswerValue) => void
  testMode?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const files: UploadedFile[] =
    value && typeof value === "object" && Array.isArray((value as { files?: unknown }).files)
      ? (value as { files: UploadedFile[] }).files
      : []
  const maxFiles = Math.max(1, field.config?.maxFiles ?? 1)
  const maxBytes = (field.config?.maxFileSizeMb ?? 10) * 1024 * 1024
  const accept = field.config?.allowedFileTypes?.join(",") || undefined

  const commit = (next: UploadedFile[]) =>
    onChange(
      next.length > 0
        ? ({ files: next } as unknown as AnswerValue)
        : (undefined as unknown as AnswerValue),
    )

  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return
    const room = maxFiles - files.length
    if (room <= 0) return
    const incoming = Array.from(list).slice(0, room)
    setUploading(true)
    let acc = files
    try {
      for (const file of incoming) {
        if (file.size > maxBytes) {
          showToast(`${file.name} is too large (max ${Math.round(maxBytes / 1048576)}MB).`, {
            type: "error",
          })
          continue
        }
        if (testMode) {
          // Builder preview — validate UX without pushing junk to Cloudinary.
          acc = [...acc, { storageKey: "", url: "", name: file.name, mime: file.type, bytes: file.size }]
          commit(acc)
          continue
        }
        try {
          const r = await uploadToCloudinary(file, "submissions")
          acc = [
            ...acc,
            { storageKey: r.publicId, url: r.secureUrl, name: file.name, mime: file.type || r.format, bytes: r.bytes },
          ]
          commit(acc)
        } catch (err) {
          console.error("[FileControl] upload failed", err)
          showToast(`Couldn't upload ${file.name}. Please try again.`, { type: "error" })
        }
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-2">
      {files.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-md border border-border bg-background p-2 pr-3 text-sm"
        >
          {f.mime?.startsWith("image/") && f.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cldDeliver(f.url, "f_auto,q_auto,w_96,h_96,c_fill")}
              alt=""
              decoding="async"
              loading="lazy"
              className="size-10 shrink-0 rounded-md border border-border object-cover"
            />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-muted/40">
              <FileIcon />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-foreground">{f.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{prettyBytes(f.bytes)}</span>
          <button
            type="button"
            onClick={() => commit(files.filter((_, j) => j !== i))}
            aria-label={`Remove ${f.name}`}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
      {files.length < maxFiles ? (
        <label
          className={cn(
            "flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted",
            invalid ? "border-destructive" : "border-border",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          {uploading ? "Uploading…" : files.length > 0 ? "Add another file" : "Click to choose a file"}
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={maxFiles > 1}
            disabled={uploading}
            className="hidden"
            onChange={(e) => void pick(e.target.files)}
          />
        </label>
      ) : null}
    </div>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5z" strokeLinejoin="round" />
    </svg>
  )
}

export function prettyBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function Check({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function Star({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3.5z" />
    </svg>
  )
}
