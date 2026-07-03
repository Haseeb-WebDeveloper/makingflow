"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  useTransition,
} from "react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateFormSettings, type FormSettingsPatch } from "@/lib/actions/forms"
import type { FormSettingsData } from "@/lib/data/forms"
import { showToast } from "@/components/ui/toast"

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

/**
 * Compute the patch to persist by diffing the working state against the last
 * saved baseline — so we only write what actually changed. "Close form" maps to
 * the server's published⇄closed toggle (never touches a draft).
 */
function diffPatch(base: FormSettingsData, next: FormSettingsData): FormSettingsPatch {
  const p: FormSettingsPatch = {}
  if (next.status !== base.status && (next.status === "published" || next.status === "closed")) {
    p.closed = next.status === "closed"
  }
  if (next.submissionLimit !== base.submissionLimit) p.submissionLimit = next.submissionLimit
  if (next.closesAt !== base.closesAt) p.closesAt = next.closesAt
  if (next.redirectUrl !== base.redirectUrl) p.redirectUrl = next.redirectUrl
  if (next.oneResponsePerPerson !== base.oneResponsePerPerson)
    p.oneResponsePerPerson = next.oneResponsePerPerson
  if (next.showProgressBar !== base.showProgressBar) p.showProgressBar = next.showProgressBar
  if (next.chooserStyle !== base.chooserStyle) p.chooserStyle = next.chooserStyle
  if (next.submitButtonLabel !== base.submitButtonLabel) p.submitButtonLabel = next.submitButtonLabel
  // thankYouMessage + success page are edited on the canvas (SuccessPageEditor).
  if (next.renderMode !== base.renderMode) p.renderMode = next.renderMode
  if (next.persona !== base.persona) p.persona = next.persona
  if (next.followUpsEnabled !== base.followUpsEnabled) p.followUpsEnabled = next.followUpsEnabled
  if (next.clarifyVagueAnswers !== base.clarifyVagueAnswers)
    p.clarifyVagueAnswers = next.clarifyVagueAnswers
  if (next.summaryEnabled !== base.summaryEnabled) p.summaryEnabled = next.summaryEnabled
  if (next.screeningEnabled !== base.screeningEnabled) p.screeningEnabled = next.screeningEnabled
  if (next.screeningCriteria !== base.screeningCriteria)
    p.screeningCriteria = next.screeningCriteria
  // Branding (logo/banner) is edited on the canvas now, not here.
  return p
}

export type FormSettingsHandle = {
  /** Persist pending changes. Resolves true on success (or when already clean). */
  save: () => Promise<boolean>
}

/**
 * Form response-collection settings. Changes are buffered in local state and
 * committed explicitly — never auto-saved — so the user is always in control of
 * when settings go live.
 *
 * - Standalone (Settings tab): renders its own sticky Save / Discard bar.
 * - Embedded (publish dialog): pass `embedded` so the dialog footer owns the
 *   Save button; it drives saving through the imperative `ref` handle and reads
 *   the dirty/saving flags via the callbacks.
 */
export const FormSettings = forwardRef<
  FormSettingsHandle,
  {
    formId: string
    initial: FormSettingsData
    embedded?: boolean
    onDirtyChange?: (dirty: boolean) => void
    onSavingChange?: (saving: boolean) => void
  }
>(function FormSettings({ formId, initial, embedded = false, onDirtyChange, onSavingChange }, ref) {
  const [baseline, setBaseline] = useState(initial)
  const [state, setState] = useState(initial)
  const [saving, startSaving] = useTransition()

  const patch = useMemo(() => diffPatch(baseline, state), [baseline, state])
  const dirty = Object.keys(patch).length > 0

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => onSavingChange?.(saving), [saving, onSavingChange])

  const save = useMemo(
    () => (): Promise<boolean> =>
      new Promise((resolve) => {
        if (!dirty) return resolve(true)
        startSaving(async () => {
          const res = await updateFormSettings(formId, patch)
          if (res.success) {
            setBaseline(state)
            showToast("Settings saved", { type: "success" })
            resolve(true)
          } else {
            showToast(res.error ?? "Couldn't save settings", { type: "error" })
            resolve(false)
          }
        })
      }),
    [dirty, patch, state, formId],
  )

  useImperativeHandle(ref, () => ({ save }), [save])

  const limitOn = state.submissionLimit != null
  const closeOn = state.closesAt != null
  const redirectOn = state.redirectUrl != null
  const isDraft = state.status === "draft"

  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 text-sm font-semibold text-foreground">Response experience</h2>
      <div className="rounded-lg border border-border px-4">
        <SettingRow
          title="How respondents fill the form"
          description="Classic shows every question on the page. Conversational asks one question at a time in an AI chat that understands natural-language replies."
          control={null}
        >
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(["classic", "conversational"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    renderMode: mode,
                    aiEnabled: mode === "conversational" ? true : s.aiEnabled,
                  }))
                }
                className={
                  "h-8 rounded px-3 text-sm font-medium transition-colors " +
                  (state.renderMode === mode
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {mode === "classic" ? "Classic" : "Conversational"}
              </button>
            ))}
          </div>
        </SettingRow>

        {state.renderMode === "conversational" ? (
          <>
            <SettingRow
              title="Persona & tone"
              description="How the AI should sound while asking questions (e.g. “friendly and casual” or “concise and formal”)."
              control={null}
            >
              <textarea
                rows={2}
                placeholder="Warm, concise, and professional."
                value={state.persona}
                onChange={(e) => setState((s) => ({ ...s, persona: e.target.value }))}
                className="scrollbar-thin w-full resize-none rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
              />
            </SettingRow>

            <SettingRow
              title="Adaptive follow-up questions"
              description="Let the AI ask the occasional natural follow-up to capture the “why” behind an answer."
              control={
                <Switch
                  checked={state.followUpsEnabled}
                  onCheckedChange={(v) => setState((s) => ({ ...s, followUpsEnabled: v }))}
                />
              }
            />

            <SettingRow
              title="Clarify vague answers"
              description="When a reply is too vague to record, the AI asks the respondent to clarify before moving on."
              control={
                <Switch
                  checked={state.clarifyVagueAnswers}
                  onCheckedChange={(v) => setState((s) => ({ ...s, clarifyVagueAnswers: v }))}
                />
              }
            />
          </>
        ) : null}
      </div>

      <h2 className="mb-1 mt-8 text-sm font-semibold text-foreground">Submission intelligence</h2>
      <div className="rounded-lg border border-border px-4">
        <SettingRow
          title="AI summary"
          description="After each response, generate a short AI summary shown at the top of the response detail. Works on classic and conversational forms."
          control={
            <Switch
              checked={state.summaryEnabled}
              onCheckedChange={(v) => setState((s) => ({ ...s, summaryEnabled: v }))}
            />
          }
        />

        <SettingRow
          title="Screening & scoring"
          description="Score each response 0–100 against criteria you describe in plain language (e.g. how well a candidate fits the role)."
          control={
            <Switch
              checked={state.screeningEnabled}
              onCheckedChange={(v) => setState((s) => ({ ...s, screeningEnabled: v }))}
            />
          }
        >
          {state.screeningEnabled ? (
            <textarea
              rows={3}
              placeholder="Describe what a strong response looks like. e.g. “Rate fit for a senior motion designer: weight portfolio quality, relevant experience, and availability.”"
              value={state.screeningCriteria}
              onChange={(e) => setState((s) => ({ ...s, screeningCriteria: e.target.value }))}
              className="scrollbar-thin w-full resize-none rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
            />
          ) : null}
        </SettingRow>
      </div>

      <h2 className="mb-1 mt-8 text-sm font-semibold text-foreground">Access</h2>
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
                setState((s) => ({ ...s, status: closed ? "closed" : "published" }))
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
                setState((s) => ({
                  ...s,
                  submissionLimit: on ? s.submissionLimit ?? 100 : null,
                }))
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
                setState((s) => ({ ...s, submissionLimit: n }))
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
                setState((s) => ({ ...s, closesAt: iso }))
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
                setState((s) => ({ ...s, closesAt: iso }))
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
              onCheckedChange={(v) => setState((s) => ({ ...s, oneResponsePerPerson: v }))}
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
                setState((s) => ({ ...s, redirectUrl: on ? s.redirectUrl ?? "" : null }))
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
              onCheckedChange={(v) => setState((s) => ({ ...s, showProgressBar: v }))}
            />
          }
        />

        <SettingRow
          title="Fill-style chooser"
          description="How respondents pick between all-at-once and one-at-a-time."
          control={
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {(
                [
                  { key: "cards", label: "Cards" },
                  { key: "list", label: "List" },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() =>
                    setState((s) => ({ ...s, chooserStyle: o.key }))
                  }
                  className={
                    "rounded px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 " +
                    (state.chooserStyle === o.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
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
            className="h-9 w-60"
          />
        </SettingRow>
        {/* The post-submit success page (title, message, media) is edited on the
            form canvas now — see SuccessPageEditor. */}
      </div>

      {/* Standalone save bar — the embedded (dialog) variant lets the footer drive saving. */}
      {!embedded && dirty ? (
        <div className="sticky bottom-4 z-10 mt-6 flex items-center gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80">
          <span className="mr-auto text-sm text-muted-foreground">You have unsaved changes</span>
          <Button
            variant="outline"
            onClick={() => setState(baseline)}
            disabled={saving}
            className="h-9 px-3"
          >
            Discard
          </Button>
          <Button onClick={() => void save()} disabled={saving} className="h-9 px-3.5">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </div>
  )
})
