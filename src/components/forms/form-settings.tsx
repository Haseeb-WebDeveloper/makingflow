"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { updateFormSettings, type FormSettingsPatch } from "@/lib/actions/forms"
import type { FormSettingsData } from "@/lib/data/forms"

function SettingRow({
  title,
  description,
  control,
  children,
}: {
  title: string
  description?: string
  control: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="border-b border-border py-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="shrink-0 pt-0.5">{control}</div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FormSettings({
  formId,
  initial,
}: {
  formId: string
  initial: FormSettingsData
}) {
  const [state, setState] = useState(initial)
  const [saving, startSaving] = useTransition()
  const [savedAt, setSavedAt] = useState(false)

  const save = (patch: FormSettingsPatch, optimistic: Partial<FormSettingsData>) => {
    setState((s) => ({ ...s, ...optimistic }))
    startSaving(async () => {
      await updateFormSettings(formId, patch)
      setSavedAt(true)
      setTimeout(() => setSavedAt(false), 1500)
    })
  }

  const limitOn = state.submissionLimit != null
  const closeOn = state.closesAt != null
  const redirectOn = state.redirectUrl != null
  const isDraft = state.status === "draft"

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex h-5 items-center justify-end">
        <span className="text-xs text-muted-foreground">
          {saving ? "Saving…" : savedAt ? "Saved" : ""}
        </span>
      </div>

      <h2 className="mb-1 text-sm font-semibold text-foreground">Access</h2>
      <div className="rounded-lg border border-border px-4">
        <SettingRow
          title="Close form"
          description={
            isDraft
              ? "Publish the form first to control whether it's accepting responses."
              : "Stop accepting new responses. Visitors see a closed message."
          }
          control={
            <Switch
              checked={state.status === "closed"}
              disabled={isDraft}
              onCheckedChange={(closed) =>
                save({ closed }, { status: closed ? "closed" : "published" })
              }
            />
          }
        />

        <SettingRow
          title="Limit submissions"
          description="Automatically close the form after a number of responses."
          control={
            <Switch
              checked={limitOn}
              onCheckedChange={(on) =>
                save(
                  { submissionLimit: on ? state.submissionLimit ?? 100 : null },
                  { submissionLimit: on ? state.submissionLimit ?? 100 : null },
                )
              }
            />
          }
        >
          {limitOn ? (
            <Input
              type="number"
              min={1}
              value={state.submissionLimit ?? ""}
              onChange={(e) =>
                setState((s) => ({ ...s, submissionLimit: Number(e.target.value) || 0 }))
              }
              onBlur={(e) => {
                const n = Math.max(1, Number(e.target.value) || 1)
                save({ submissionLimit: n }, { submissionLimit: n })
              }}
              className="h-9 w-40"
            />
          ) : null}
        </SettingRow>

        <SettingRow
          title="Close on a date"
          description="Stop accepting responses after a specific date and time."
          control={
            <Switch
              checked={closeOn}
              onCheckedChange={(on) => {
                const iso = on ? new Date(Date.now() + 7 * 864e5).toISOString() : null
                save({ closesAt: iso }, { closesAt: iso })
              }}
            />
          }
        >
          {closeOn ? (
            <Input
              type="datetime-local"
              value={toLocalInput(state.closesAt)}
              onChange={(e) => {
                const iso = e.target.value ? new Date(e.target.value).toISOString() : null
                save({ closesAt: iso }, { closesAt: iso })
              }}
              className="h-9 w-60"
            />
          ) : null}
        </SettingRow>

        <SettingRow
          title="Prevent duplicate submissions"
          description="Allow only one response per person."
          control={
            <Switch
              checked={state.oneResponsePerPerson}
              onCheckedChange={(v) =>
                save({ oneResponsePerPerson: v }, { oneResponsePerPerson: v })
              }
            />
          }
        />
      </div>

      <h2 className="mb-1 mt-8 text-sm font-semibold text-foreground">Behavior</h2>
      <div className="rounded-lg border border-border px-4">
        <SettingRow
          title="Redirect on completion"
          description="Send respondents to a URL after they submit."
          control={
            <Switch
              checked={redirectOn}
              onCheckedChange={(on) =>
                save(
                  { redirectUrl: on ? state.redirectUrl ?? "" : null },
                  { redirectUrl: on ? state.redirectUrl ?? "" : null },
                )
              }
            />
          }
        >
          {redirectOn ? (
            <Input
              type="url"
              placeholder="https://example.com/thank-you"
              value={state.redirectUrl ?? ""}
              onChange={(e) => setState((s) => ({ ...s, redirectUrl: e.target.value }))}
              onBlur={(e) => save({ redirectUrl: e.target.value }, { redirectUrl: e.target.value })}
              className="h-9 w-full"
            />
          ) : null}
        </SettingRow>

        <SettingRow
          title="Progress bar"
          description="Show respondents how far through the form they are."
          control={
            <Switch
              checked={state.showProgressBar}
              onCheckedChange={(v) => save({ showProgressBar: v }, { showProgressBar: v })}
            />
          }
        />

        <SettingRow
          title="Submit button label"
          description="Customize the text on the final submit button."
          control={null}
        >
          <Input
            placeholder="Submit"
            value={state.submitButtonLabel}
            onChange={(e) => setState((s) => ({ ...s, submitButtonLabel: e.target.value }))}
            onBlur={(e) =>
              save({ submitButtonLabel: e.target.value }, { submitButtonLabel: e.target.value })
            }
            className="h-9 w-60"
          />
        </SettingRow>

        <SettingRow
          title="Success message"
          description={
            state.redirectUrl
              ? "Shown after submitting — unless the redirect URL above is set, which takes precedence."
              : "Shown to respondents after they submit the form."
          }
          control={null}
        >
          <textarea
            rows={2}
            placeholder="Thanks! Your response has been recorded."
            value={state.thankYouMessage}
            onChange={(e) => setState((s) => ({ ...s, thankYouMessage: e.target.value }))}
            onBlur={(e) =>
              save({ thankYouMessage: e.target.value }, { thankYouMessage: e.target.value })
            }
            className="scrollbar-thin w-full resize-none rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
          />
        </SettingRow>
      </div>
    </div>
  )
}
