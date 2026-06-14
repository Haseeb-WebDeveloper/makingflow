"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateFormSettings, type FormSettingsPatch } from "@/lib/actions/forms"
import type { FormSettingsData } from "@/lib/data/forms"
import { uploadToCloudinary } from "@/lib/cloudinary/upload"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

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
    <div className="border-b border-border py-4 lg:py-[1.111vw] last:border-0">
      <div className="flex items-start justify-between gap-4 lg:gap-[1.111vw]">
        <div className="min-w-0">
          <p className="text-sm lg:text-[0.972vw] font-medium text-foreground">{title}</p>
          {description ? (
            <p className="mt-0.5 lg:mt-[0.139vw] text-sm lg:text-[0.972vw] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="shrink-0 pt-0.5 lg:pt-[0.139vw]">{control}</div>
      </div>
      {children ? <div className="mt-3 lg:mt-[0.833vw]">{children}</div> : null}
    </div>
  )
}

/** Cloudinary-backed image picker for the Branding section (logo / banner). */
function ImageUpload({
  label,
  description,
  value,
  onChange,
  variant,
}: {
  label: string
  description: string
  value: string | null
  onChange: (url: string | null) => void
  variant: "logo" | "banner"
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

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
    setUploading(true)
    try {
      const r = await uploadToCloudinary(file, "formAssets")
      onChange(r.secureUrl)
    } catch {
      showToast("Couldn't upload that image. Please try again.", { type: "error" })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <SettingRow
      title={label}
      description={description}
      control={
        value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-sm lg:text-[0.972vw] font-medium text-destructive hover:underline"
          >
            Remove
          </button>
        ) : null
      }
    >
      <div className="flex items-center gap-3 lg:gap-[0.833vw]">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className={cn(
              "rounded-md lg:rounded-[0.556vw] border border-border bg-background",
              variant === "banner" ? "h-16 lg:h-[4.444vw] w-32 lg:w-[8.889vw] object-cover" : "size-12 lg:size-[3.333vw] object-contain p-1 lg:p-[0.278vw]",
            )}
          />
        ) : null}
        <label
          className={cn(
            "inline-flex h-9 lg:h-[2.5vw] cursor-pointer items-center rounded-md lg:rounded-[0.556vw] border border-border px-3 lg:px-[0.833vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
      </div>
    </SettingRow>
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
  if (next.submitButtonLabel !== base.submitButtonLabel) p.submitButtonLabel = next.submitButtonLabel
  if (next.thankYouMessage !== base.thankYouMessage) p.thankYouMessage = next.thankYouMessage
  if (next.renderMode !== base.renderMode) p.renderMode = next.renderMode
  if (next.persona !== base.persona) p.persona = next.persona
  if (next.followUpsEnabled !== base.followUpsEnabled) p.followUpsEnabled = next.followUpsEnabled
  if (next.clarifyVagueAnswers !== base.clarifyVagueAnswers)
    p.clarifyVagueAnswers = next.clarifyVagueAnswers
  if (next.logoUrl !== base.logoUrl) p.logoUrl = next.logoUrl
  if (next.coverImageUrl !== base.coverImageUrl) p.coverImageUrl = next.coverImageUrl
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
    <div className="max-w-2xl lg:max-w-[46.667vw]">
      <h2 className="mb-1 lg:mb-[0.278vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">Response experience</h2>
      <div className="rounded-lg lg:rounded-[0.694vw] border border-border px-4 lg:px-[1.111vw]">
        <SettingRow
          title="How respondents fill the form"
          description="Classic shows every question on the page. Conversational asks one question at a time in an AI chat that understands natural-language replies."
          control={null}
        >
          <div className="inline-flex rounded-md lg:rounded-[0.556vw] border border-border p-0.5 lg:p-[0.139vw]">
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
                  "h-8 lg:h-[2.222vw] rounded lg:rounded-[0.324vw] px-3 lg:px-[0.833vw] text-sm lg:text-[0.972vw] font-medium transition-colors " +
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
              description="How the AI should sound while asking questions — e.g. “friendly and casual” or “concise and formal”."
              control={null}
            >
              <textarea
                rows={2}
                placeholder="Warm, concise, and professional."
                value={state.persona}
                onChange={(e) => setState((s) => ({ ...s, persona: e.target.value }))}
                className="scrollbar-thin w-full resize-none rounded-md lg:rounded-[0.556vw] border border-input bg-input/30 px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
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

      <h2 className="mb-1 lg:mb-[0.278vw] mt-8 lg:mt-[2.222vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">Branding</h2>
      <div className="rounded-lg lg:rounded-[0.694vw] border border-border px-4 lg:px-[1.111vw]">
        <ImageUpload
          label="Logo"
          description="A small logo shown above the form title."
          value={state.logoUrl}
          onChange={(url) => setState((s) => ({ ...s, logoUrl: url }))}
          variant="logo"
        />
        <ImageUpload
          label="Banner"
          description="A wide cover image shown at the very top of the form."
          value={state.coverImageUrl}
          onChange={(url) => setState((s) => ({ ...s, coverImageUrl: url }))}
          variant="banner"
        />
      </div>

      <h2 className="mb-1 lg:mb-[0.278vw] mt-8 lg:mt-[2.222vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">Access</h2>
      <div className="rounded-lg lg:rounded-[0.694vw] border border-border px-4 lg:px-[1.111vw]">
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
              className="h-9 lg:h-[2.5vw] w-40 lg:w-[11.111vw]"
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
              className="h-9 lg:h-[2.5vw] w-60 lg:w-[16.667vw]"
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

      <h2 className="mb-1 lg:mb-[0.278vw] mt-8 lg:mt-[2.222vw] text-sm lg:text-[0.972vw] font-semibold text-foreground">Behavior</h2>
      <div className="rounded-lg lg:rounded-[0.694vw] border border-border px-4 lg:px-[1.111vw]">
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
              className="h-9 lg:h-[2.5vw] w-full"
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
          title="Submit button label"
          description="Customize the text on the final submit button."
          control={null}
        >
          <Input
            placeholder="Submit"
            value={state.submitButtonLabel}
            onChange={(e) => setState((s) => ({ ...s, submitButtonLabel: e.target.value }))}
            className="h-9 lg:h-[2.5vw] w-60 lg:w-[16.667vw]"
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
            className="scrollbar-thin w-full resize-none rounded-md lg:rounded-[0.556vw] border border-input bg-input/30 px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
          />
        </SettingRow>
      </div>

      {/* Standalone save bar — the embedded (dialog) variant lets the footer drive saving. */}
      {!embedded && dirty ? (
        <div className="sticky bottom-4 lg:bottom-[1.111vw] z-10 mt-6 lg:mt-[1.667vw] flex items-center gap-3 lg:gap-[0.833vw] rounded-lg lg:rounded-[0.694vw] border border-border bg-background/95 px-4 lg:px-[1.111vw] py-3 lg:py-[0.833vw] shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80">
          <span className="mr-auto text-sm lg:text-[0.972vw] text-muted-foreground">You have unsaved changes</span>
          <Button
            variant="outline"
            onClick={() => setState(baseline)}
            disabled={saving}
            className="h-9 lg:h-[2.5vw] px-3 lg:px-[0.833vw]"
          >
            Discard
          </Button>
          <Button onClick={() => void save()} disabled={saving} className="h-9 lg:h-[2.5vw] px-3.5 lg:px-[0.972vw]">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </div>
  )
})
