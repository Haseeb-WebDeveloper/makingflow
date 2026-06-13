"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { experimental_useObject as useObject } from "@ai-sdk/react"
import { aiFormSchema, type AiForm } from "@/lib/ai/form-schema"
import { saveAiForm, publishForm, unpublishForm } from "@/lib/actions/forms"
import { type EditorForm, editorToAi, mergeAiIntoEditor } from "@/lib/builder/form-model"
import { FormPreview, type PartialForm } from "@/components/builder/form-preview"
import { FormEditor } from "@/components/builder/form-editor"
import { FormRuntime } from "@/components/forms/form-runtime"
import type { PublicForm } from "@/lib/data/public-form"
import { AiLottie } from "@/components/builder/ai-lottie"
import { Composer, type ComposerImage } from "@/components/builder/composer"
import { Button } from "@/components/ui/button"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  image?: string
}

type SaveState = "idle" | "saving" | "saved" | "error"

let _seq = 0
const rid = () => `m${++_seq}`

export function FormBuilder({
  initialForm,
  initialFormId,
  initialStatus,
  initialPublicId,
}: {
  initialForm?: EditorForm
  initialFormId?: string
  initialStatus?: string
  initialPublicId?: string | null
} = {}) {
  const router = useRouter()

  const [chat, setChat] = useState<ChatMessage[]>(() =>
    initialForm
      ? [
          {
            id: rid(),
            role: "assistant",
            text: `Loaded “${initialForm.title}”. Ask for any changes.`,
          },
        ]
      : [],
  )
  const [draft, setDraft] = useState("")
  const [image, setImage] = useState<ComposerImage | null>(null)
  const [currentForm, setCurrentForm] = useState<EditorForm | null>(initialForm ?? null)
  const [formId, setFormId] = useState<string | null>(initialFormId ?? null)
  const [saveState, setSaveState] = useState<SaveState>(initialFormId ? "saved" : "idle")
  const [published, setPublished] = useState(initialStatus === "published")
  const [publicId, setPublicId] = useState<string | null>(initialPublicId ?? null)
  const [publishing, setPublishing] = useState(false)
  const [origin, setOrigin] = useState("")
  const [mode, setMode] = useState<"edit" | "preview">("edit")

  const formIdRef = useRef<string | null>(initialFormId ?? null)
  const currentFormRef = useRef<EditorForm | null>(initialForm ?? null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { object, submit, isLoading, error, stop, clear } = useObject({
    api: "/api/ai/form",
    schema: aiFormSchema,
    onFinish: ({ object }) => {
      if (!object) return
      // Merge onto the current form so manual ids + logic survive the AI edit.
      const full = mergeAiIntoEditor(object as AiForm, currentFormRef.current)
      currentFormRef.current = full
      setCurrentForm(full)
      setChat((prev) => {
        const isFirst = !prev.some((m) => m.role === "assistant")
        const text = isFirst
          ? full.title
            ? `Here's your form — “${full.title}”. Ask for any changes.`
            : "Here's your form. Ask for any changes."
          : "Done — updated the form."
        return [...prev, { id: rid(), role: "assistant", text }]
      })
      scheduleAutosave(full)
    },
  })

  // The streaming partial (AI building) vs the committed editable form.
  const streaming = object as unknown as PartialForm | undefined
  const headerTitle = currentForm?.title || streaming?.title || "New form"
  const started =
    chat.length > 0 || isLoading || Boolean(object) || Boolean(currentForm)
  const shareUrl = publicId && origin ? `${origin}/f/${publicId}` : ""

  // The committed form mapped to the public runtime shape, for the test preview.
  const previewForm: PublicForm | null = currentForm
    ? {
        publicId: publicId ?? "preview",
        title: currentForm.title || "Untitled form",
        submitLabel: "Submit",
        thankYou: "Looks good — this was a test, no response was recorded.",
        fields: currentForm.fields.map((f) => ({
          id: f.id,
          type: f.type,
          label: f.label,
          description: f.description,
          placeholder: f.placeholder,
          required: f.required,
          options: f.options,
          logic: f.logic,
        })),
      }
    : null

  function updateForm(next: EditorForm) {
    currentFormRef.current = next
    setCurrentForm(next)
    scheduleAutosave(next)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [chat, isLoading])

  useEffect(() => {
    setOrigin(window.location.origin)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // Keep the ref in sync so AI edits merge onto the latest form (incl. manual edits).
  useEffect(() => {
    currentFormRef.current = currentForm
  }, [currentForm])

  // ── Persistence ───────────────────────────────────────────────────
  async function doSave(formToSave: EditorForm) {
    setSaveState("saving")
    const res = await saveAiForm({ formId: formIdRef.current, form: formToSave })
    if (res.success) {
      formIdRef.current = res.id
      setFormId(res.id)
      setSaveState("saved")
    } else {
      setSaveState("error")
      showToast(res.error, { type: "error" })
    }
  }

  function scheduleAutosave(formToSave: EditorForm) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void doSave(formToSave), 800)
  }

  function saveNow() {
    if (!currentForm || isLoading) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void doSave(currentForm)
  }

  async function publish() {
    if (!currentForm || isLoading || publishing) return
    setPublishing(true)
    // Ensure the form is saved (has an id) before publishing.
    let id = formIdRef.current
    if (!id) {
      const saved = await saveAiForm({ formId: null, form: currentForm })
      if (!saved.success) {
        setPublishing(false)
        showToast(saved.error, { type: "error" })
        return
      }
      id = saved.id
      formIdRef.current = id
      setFormId(id)
      setSaveState("saved")
    }
    const res = await publishForm(id)
    setPublishing(false)
    if (res.success) {
      setPublished(true)
      setPublicId(res.publicId)
      showToast("Your form is live 🎉", { type: "success" })
    } else {
      showToast(res.error, { type: "error" })
    }
  }

  async function unpublish() {
    const id = formIdRef.current
    if (!id) return
    const res = await unpublishForm(id)
    if (res.success) setPublished(false)
    else showToast(res.error ?? "Could not unpublish", { type: "error" })
  }

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      showToast("Link copied", { type: "success" })
    } catch {
      showToast("Couldn't copy the link", { type: "error" })
    }
  }

  // ── Conversation ──────────────────────────────────────────────────
  function send() {
    if (isLoading) return
    const text = draft.trim()
    if (!text && !image) return

    const transcript = chat.map((m) => ({ role: m.role, text: m.text }))
    setChat((prev) => [
      ...prev,
      {
        id: rid(),
        role: "user",
        text: text || "Recreate this form from the reference image.",
        image: image?.url,
      },
    ])

    submit({
      instruction: text,
      image: image?.url,
      current: currentForm ? editorToAi(currentForm) : undefined, // edits build on the committed form
      transcript, // model gets the conversation so far
    })

    setDraft("")
    setImage(null)
  }

  function startOver() {
    stop()
    clear()
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setChat([])
    setDraft("")
    setImage(null)
    setCurrentForm(null)
    setFormId(null)
    formIdRef.current = null
    setSaveState("idle")
    setPublished(false)
    setPublicId(null)
    setMode("edit")
    router.replace("/forms/new")
  }

  async function pickFile(file: File) {
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", { type: "error" })
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      showToast("That image is too large (max 12MB).", { type: "error" })
      return
    }
    try {
      const url = await fileToDataUrl(file)
      setImage({ url, name: file.name })
    } catch {
      showToast("Couldn't read that image. Try another one.", { type: "error" })
    }
  }

  // ── Empty state — describe the form ───────────────────────────────
  if (!started) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <AiLottie className="size-20" />
            <h1 className="mt-2 font-sebenta text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Describe your form
            </h1>
            <p className="mt-3 max-w-md text-muted-foreground">
              Tell MakingFlow what you need in plain language — it builds the form
              live, then refines it as you ask for changes.
            </p>
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            placeholder="Describe your form, or attach a screenshot to recreate — e.g. a job application with a portfolio link and availability…"
            image={image}
            onRemoveImage={() => setImage(null)}
            onPickFile={pickFile}
            busy={isLoading}
            submitLabel="Generate form"
            rows={5}
            autoFocus
          />
        </div>
      </div>
    )
  }

  // ── Active state — conversation + live preview ────────────────────
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:flex-row">
      <aside className="flex h-1/2 shrink-0 flex-col border-b border-border lg:h-full lg:w-[380px] lg:border-b-0 lg:border-r">
        <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {chat.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} message={m} />
            ) : (
              <AssistantRow key={m.id} text={m.text} />
            ),
          )}
          {isLoading ? <AssistantRow building /> : null}
          {error ? (
            <div className="ml-8 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Something went wrong. Check your Gemini key and try again.
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            placeholder="Ask for changes — e.g. add a phone number, make email required…"
            image={image}
            onRemoveImage={() => setImage(null)}
            onPickFile={pickFile}
            busy={isLoading}
            submitLabel=""
            rows={2}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="mt-2 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Stop generating
            </button>
          ) : null}
        </div>
      </aside>

      <main className="flex h-1/2 min-w-0 flex-1 flex-col lg:h-full">
        <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate font-sebenta text-sm font-semibold text-foreground">
              {headerTitle}
            </p>
            <SaveStatus state={saveState} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ModeToggle
              mode={mode}
              onChange={setMode}
              disabled={isLoading || !currentForm}
            />
            <Button
              variant="ghost"
              onClick={startOver}
              disabled={isLoading}
              className="h-8 px-2.5 text-muted-foreground"
            >
              New
            </Button>
            <Button
              variant="outline"
              onClick={saveNow}
              disabled={!currentForm || isLoading || saveState === "saving"}
              className="h-8 px-3"
            >
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}
            </Button>
            {!published ? (
              <Button
                onClick={publish}
                disabled={!currentForm || isLoading || publishing}
                className="h-8 px-3"
              >
                {publishing ? "Publishing…" : "Publish"}
              </Button>
            ) : null}
          </div>
        </header>

        {published && publicId ? (
          <div className="flex items-center gap-2 border-b border-border bg-success/5 px-5 py-2">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              Live
            </span>
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
              {shareUrl || `/f/${publicId}`}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
            >
              Copy
            </button>
            <a
              href={shareUrl || `/f/${publicId}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
            >
              Open
            </a>
            <button
              type="button"
              onClick={unpublish}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Unpublish
            </button>
          </div>
        ) : null}

        <div className="thin-scroll flex-1 overflow-x-hidden overflow-y-auto bg-canvas px-6 py-10 sm:px-10">
          {isLoading || !currentForm ? (
            <FormPreview form={streaming} building={isLoading} />
          ) : mode === "preview" && previewForm ? (
            <FormRuntime form={previewForm} testMode />
          ) : (
            <FormEditor form={currentForm} onChange={updateForm} />
          )}
        </div>
      </main>
    </div>
  )
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "edit" | "preview"
  onChange: (m: "edit" | "preview") => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
      {(["edit", "preview"] as const).map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50",
            mode === m
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle") return null
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed"
  return (
    <span
      className={cn(
        "shrink-0 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  )
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
        {message.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.image}
            alt=""
            className="mb-2 max-h-40 w-full rounded-lg object-cover"
          />
        ) : null}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  )
}

function AssistantRow({ text, building }: { text?: string; building?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo/logo.svg"
        alt=""
        className="mt-1 size-6 shrink-0 rounded-md object-contain"
      />
      {building ? (
        <span className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
          Building your form
          <Dots />
        </span>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
      )}
    </div>
  )
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground" />
    </span>
  )
}

/**
 * Read an image File into a data URL, downscaling its long edge so the payload
 * (and Gemini's image tokens) stay reasonable. Falls back to the original.
 */
async function fileToDataUrl(file: File, maxEdge = 1568): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  try {
    const img = await loadImage(dataUrl)
    const longEdge = Math.max(img.width, img.height)
    const scale = Math.min(1, maxEdge / longEdge)
    if (scale === 1) return dataUrl

    const canvas = document.createElement("canvas")
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.9)
  } catch {
    return dataUrl
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
