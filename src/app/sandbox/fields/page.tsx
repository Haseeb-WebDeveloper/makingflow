"use client"

import { useState } from "react"
import Link from "next/link"

import { Field } from "@/components/forms/field-control"
import type { PublicField } from "@/lib/data/public-form"
import type { AnswerValue, FieldConfig } from "@/lib/db/schema"
import { Switch } from "@/components/ui/switch"

/**
 * /sandbox/fields — every answerable field rendered by the REAL runtime
 * component, so a control can be looked at without publishing a form and
 * filling it in. Dev only, not linked from the product.
 *
 * Each card shows the stored answer underneath it. That is the half of a
 * control you normally cannot see, and it is where the bugs live: a date that
 * silently stores free text, a choice that stores its own label, a time that
 * never makes it into the value. Toggle required/error to check the states a
 * respondent actually hits.
 */

type Spec = {
  id: string
  label: string
  type: PublicField["type"]
  description?: string
  options?: string[]
  config?: FieldConfig
  note?: string
}

const SPECS: Spec[] = [
  { id: "short_text", label: "What is your name?", type: "short_text" },
  {
    id: "long_text",
    label: "Tell us about the role",
    type: "long_text",
    description: "A few sentences is plenty.",
  },
  { id: "email", label: "Email address", type: "email" },
  { id: "phone", label: "Phone number", type: "phone" },
  { id: "url", label: "Portfolio link", type: "url" },

  {
    id: "date",
    label: "When can you start?",
    type: "date",
    note: "Month + year dropdowns — a date of birth used to be ~370 arrow clicks away.",
  },
  {
    id: "date_time",
    label: "Pick an interview slot",
    type: "date",
    config: { includeTime: true },
    note: "config.includeTime. Stores 2026-09-21T14:30 — one string, still sorts chronologically.",
  },
  { id: "time", label: "Preferred time of day", type: "time" },

  {
    id: "multiple_choice",
    label: "How did you hear about us?",
    type: "multiple_choice",
    options: ["Search", "A friend", "Social"],
  },
  {
    id: "checkboxes",
    label: "Which apply to you?",
    type: "checkboxes",
    options: ["Remote", "Hybrid", "On-site"],
  },
  {
    id: "dropdown",
    label: "Country",
    type: "dropdown",
    options: ["Italy", "Pakistan", "United Kingdom"],
  },
  {
    id: "multi_select",
    label: "Skills",
    type: "multi_select",
    options: ["Figma", "React", "Copywriting"],
  },
  { id: "yes_no", label: "Enjoying this so far?", type: "yes_no" },
  {
    id: "other",
    label: "Which tool do you use?",
    type: "multiple_choice",
    options: ["Tally", "Typeform"],
    config: { allowOther: true },
    note: "allowOther stores whatever is typed — not the word 'Other'.",
  },

  { id: "rating", label: "Rate the process", type: "rating", config: { ratingMax: 5, ratingIcon: "star" } },
  {
    id: "scale",
    label: "How confident are you?",
    type: "scale",
    config: { min: 1, max: 5, minLabel: "Not at all", maxLabel: "Very" },
  },
  { id: "nps", label: "How likely are you to recommend us?", type: "nps" },

  { id: "file_upload", label: "Attach your CV", type: "file_upload" },
]

export default function FieldsSandbox() {
  const [values, setValues] = useState<Record<string, AnswerValue>>({})
  const [required, setRequired] = useState(false)
  const [showError, setShowError] = useState(false)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Field gallery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every control, rendered by the runtime itself, with the answer it stores. Dev only.
        </p>
        <nav className="mt-3 flex gap-3 text-sm">
          <Link href="/sandbox" className="text-muted-foreground underline hover:text-foreground">
            Conversational states
          </Link>
          <Link
            href="/sandbox/chooser"
            className="text-muted-foreground underline hover:text-foreground"
          >
            Fill-style chooser
          </Link>
        </nav>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-6 rounded-lg border border-border px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={required} onCheckedChange={setRequired} />
          Required
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={showError} onCheckedChange={setShowError} />
          Error state
        </label>
        <button
          type="button"
          onClick={() => setValues({})}
          className="ml-auto rounded-md border border-border px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Clear answers
        </button>
      </div>

      <div className="space-y-4">
        {SPECS.map((spec) => {
          const field = {
            id: spec.id,
            type: spec.type,
            label: spec.label,
            description: spec.description,
            required,
            options: spec.options?.map((label) => ({ id: label, label })),
            config: spec.config,
          } as PublicField

          const value = values[spec.id]
          return (
            <section key={spec.id} className="rounded-xl border border-border bg-canvas p-5">
              <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {spec.type}
                {spec.config ? ` · ${JSON.stringify(spec.config)}` : ""}
              </p>
              <Field
                field={field}
                value={value}
                error={showError ? "This is what an error looks like." : undefined}
                onChange={(v) => setValues((s) => ({ ...s, [spec.id]: v }))}
                testMode
              />
              {spec.note ? (
                <p className="mt-3 text-xs text-muted-foreground">{spec.note}</p>
              ) : null}
              <pre className="mt-3 overflow-x-auto rounded bg-muted p-2 text-[11px] text-foreground">
                {value === undefined ? "(no answer)" : JSON.stringify(value)}
              </pre>
            </section>
          )
        })}
      </div>
    </div>
  )
}
