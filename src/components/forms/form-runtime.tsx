"use client"

import { useMemo, useState } from "react"
import { submitForm } from "@/lib/actions/submissions"
import type { PublicForm, PublicField } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"
import { cn } from "@/lib/utils"

const NON_ANSWER = new Set(["heading", "paragraph", "image", "embed", "page_break"])

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

  const answerable = useMemo(
    () => form.fields.filter((f) => !NON_ANSWER.has(f.type)),
    [form.fields],
  )

  function setValue(id: string, value: AnswerValue) {
    setValues((prev) => ({ ...prev, [id]: value }))
    if (errors[id]) setErrors((prev) => ({ ...prev, [id]: false }))
  }

  function isEmpty(v: AnswerValue | undefined) {
    return v == null || v === "" || (Array.isArray(v) && v.length === 0)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const missing: Record<string, boolean> = {}
    for (const f of answerable) {
      if (f.required && isEmpty(values[f.id])) missing[f.id] = true
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing)
      setError("Please answer the required questions.")
      // Scroll to the first missing field.
      const firstId = answerable.find((f) => missing[f.id])?.id
      if (firstId) document.getElementById(`field-${firstId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }

    // Test mode (builder preview): behave like a real submit, but don't persist.
    if (testMode) {
      setDone(true)
      return
    }

    setSubmitting(true)
    const payload = answerable
      .filter((f) => !isEmpty(values[f.id]))
      .map((f) => ({ fieldId: f.id, value: values[f.id]! }))

    const res = await submitForm({ publicId: form.publicId, answers: payload })
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
        {form.fields.map((field) => (
          <Field
            key={field.id}
            field={field}
            value={values[field.id]}
            invalid={!!errors[field.id]}
            onChange={(v) => setValue(field.id, v)}
          />
        ))}
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
}: {
  field: PublicField
  value: AnswerValue | undefined
  invalid: boolean
  onChange: (v: AnswerValue) => void
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
      <Control field={field} value={value} invalid={invalid} onChange={onChange} />
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
}: {
  field: PublicField
  value: AnswerValue | undefined
  invalid: boolean
  onChange: (v: AnswerValue) => void
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
      return (
        <label className={cn("flex h-24 cursor-pointer items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground hover:bg-muted", invalid ? "border-destructive" : "border-border")}>
          {str ? <span className="text-foreground">{str}</span> : "Click to choose a file"}
          <input
            type="file"
            className="hidden"
            onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")}
          />
        </label>
      )

    default:
      return (
        <input value={str} onChange={(e) => onChange(e.target.value)} className={cn(inputBase, border)} />
      )
  }
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
