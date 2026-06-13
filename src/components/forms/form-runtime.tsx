"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { submitForm } from "@/lib/actions/submissions"
import type { PublicForm, PublicField } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"
import { isFieldVisible } from "@/lib/builder/logic"
import { uploadToCloudinary } from "@/lib/cloudinary/upload"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

export type UploadedFile = {
  storageKey: string
  url: string
  name: string
  mime: string
  bytes: number
}

const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])

/** Original referrer + UTM/query params, read from the browser at submit time. */
function collectClientMeta(): { referrer?: string; urlParams?: Record<string, string> } {
  if (typeof window === "undefined") return {}
  const referrer = document.referrer || undefined
  const urlParams: Record<string, string> = {}
  try {
    const params = new URLSearchParams(window.location.search)
    for (const [k, v] of params) {
      if (/^(utm_|ref$|gclid$|fbclid$|source$)/i.test(k) && v) urlParams[k] = v.slice(0, 200)
    }
  } catch {
    /* ignore */
  }
  return {
    referrer,
    urlParams: Object.keys(urlParams).length > 0 ? urlParams : undefined,
  }
}

/** Fire-and-forget funnel beacon — never blocks or surfaces errors. */
function track(publicId: string, type: "view" | "start") {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicId, type }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

export function FormRuntime({
  form,
  testMode = false,
}: {
  form: PublicForm
  /** Builder preview: validate + show the thank-you, but never record a submission. */
  testMode?: boolean
}) {
  const [values, setValues] = useState<Record<string, AnswerValue>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const startedRef = useRef(false)

  const answerable = useMemo(
    () => form.fields.filter((f) => !NON_ANSWER.has(f.type)),
    [form.fields],
  )

  // Funnel: count a view once per render of a real (non-preview) form.
  useEffect(() => {
    if (testMode) return
    track(form.publicId, "view")
  }, [testMode, form.publicId])

  function setValue(id: string, value: AnswerValue) {
    setValues((prev) => ({ ...prev, [id]: value }))
    if (errors[id]) setErrors((prev) => ({ ...prev, [id]: false }))
    // Funnel: first interaction = a "start".
    if (!testMode && !startedRef.current) {
      startedRef.current = true
      track(form.publicId, "start")
    }
  }

  function isEmpty(v: AnswerValue | undefined) {
    return v == null || v === "" || (Array.isArray(v) && v.length === 0)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Only validate/submit answers for fields that are currently VISIBLE.
    const live = answerable.filter((f) => isFieldVisible(f.logic, values))

    const missing: Record<string, boolean> = {}
    for (const f of live) {
      if (f.required && isEmpty(values[f.id])) missing[f.id] = true
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing)
      setError("Please answer the required questions.")
      // Scroll to the first missing field.
      const firstId = live.find((f) => missing[f.id])?.id
      if (firstId) document.getElementById(`field-${firstId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }

    // Test mode (builder preview): behave like a real submit, but don't persist.
    if (testMode) {
      setDone(true)
      return
    }

    setSubmitting(true)
    const payload = live
      .filter((f) => !isEmpty(values[f.id]))
      .map((f) => ({ fieldId: f.id, value: values[f.id]! }))

    const res = await submitForm({
      publicId: form.publicId,
      answers: payload,
      meta: collectClientMeta(),
    })
    setSubmitting(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-background p-8 text-center sm:p-10">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
          <Check className="size-6" />
        </div>
        <h2 className="font-sebenta text-xl font-bold tracking-tight text-foreground">
          {form.thankYou}
        </h2>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-background p-6 sm:p-8" noValidate>
      <header className="mb-8">
        <h1 className="font-sebenta text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {form.title}
        </h1>
      </header>

      <div className="space-y-7">
        {form.fields.map((field) =>
          isFieldVisible(field.logic, values) ? (
            <Field
              key={field.id}
              field={field}
              value={values[field.id]}
              invalid={!!errors[field.id]}
              onChange={(v) => setValue(field.id, v)}
              testMode={testMode}
            />
          ) : null,
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
      >
        {submitting ? "Submitting…" : form.submitLabel}
      </button>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Made with{" "}
        <a href="/" className="font-medium text-foreground hover:underline">
          MakingFlow
        </a>
      </p>
    </form>
  )
}

function Field({
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
  if (field.type === "heading") {
    return <h2 className="pt-2 font-sebenta text-lg font-semibold text-foreground">{field.label}</h2>
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
      <Control field={field} value={value} invalid={invalid} onChange={onChange} testMode={testMode} />
    </div>
  )
}

const inputBase =
  "h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/40"

function Control({
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

    case "email":
    case "phone":
    case "url":
    case "short_text":
      return (
        <input
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "phone" ? "tel" : "text"}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputBase, border)}
        />
      )

    case "date":
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} className={cn(inputBase, border)} />
    case "time":
      return <input type="time" value={str} onChange={(e) => onChange(e.target.value)} className={cn(inputBase, border)} />

    case "dropdown":
      return (
        <select
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputBase, border, "appearance-none")}
        >
          <option value="" disabled>
            Select an option
          </option>
          {opts.map((o) => (
            <option key={o.id} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
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
              <button
                key={o.id}
                type="button"
                onClick={() => onChange(checked ? arr.filter((v) => v !== o.label) : [...arr, o.label])}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                  checked ? "border-foreground bg-muted" : cn(border, "hover:bg-muted"),
                )}
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] border", checked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50")}>
                  {checked ? <Check className="size-3" /> : null}
                </span>
                {o.label}
              </button>
            )
          })}
        </div>
      )

    case "rating": {
      const current = typeof value === "number" ? value : 0
      return (
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star`}>
              <Star className={cn("size-7", n <= current ? "text-foreground" : "text-muted-foreground/40")} filled={n <= current} />
            </button>
          ))}
        </div>
      )
    }

    case "scale":
    case "nps": {
      const from = field.type === "nps" ? 0 : 1
      const to = field.type === "nps" ? 10 : 5
      const current = typeof value === "number" ? value : null
      const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i)
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
          className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <FileIcon />
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

function prettyBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Check({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function Star({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3.5z" />
    </svg>
  )
}
