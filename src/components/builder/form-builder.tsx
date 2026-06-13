"use client"

import { useEffect, useRef, useState } from "react"
import { experimental_useObject as useObject } from "@ai-sdk/react"
import { aiFormSchema, type AiForm } from "@/lib/ai/form-schema"
import { FormPreview, type PartialForm } from "@/components/builder/form-preview"
import { AiLottie } from "@/components/builder/ai-lottie"
import { Composer, type ComposerImage } from "@/components/builder/composer"
import { Button } from "@/components/ui/button"
import { showToast } from "@/components/ui/toast"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  image?: string
}

let _seq = 0
const rid = () => `m${++_seq}`

export function FormBuilder() {
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [image, setImage] = useState<ComposerImage | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { object, submit, isLoading, error, stop, clear } = useObject({
    api: "/api/ai/form",
    schema: aiFormSchema,
    onFinish: ({ object }) => {
      if (!object) return
      setChat((prev) => {
        const isFirst = !prev.some((m) => m.role === "assistant")
        const title = (object as Partial<AiForm>).title
        const text = isFirst
          ? title
            ? `Here's your form — “${title}”. Ask for any changes.`
            : "Here's your form. Ask for any changes."
          : "Done — updated the form."
        return [...prev, { id: rid(), role: "assistant", text }]
      })
    },
  })

  const form = object as unknown as PartialForm | undefined
  const started = chat.length > 0 || isLoading || Boolean(form)

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [chat, isLoading])

  function send() {
    if (isLoading) return
    const text = draft.trim()
    if (!text && !image) return

    const hadForm = chat.some((m) => m.role === "assistant")
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
      current: hadForm ? form : undefined, // gives the edit its current state
      transcript, // gives the model the conversation so far
    })

    setDraft("")
    setImage(null)
  }

  function startOver() {
    stop()
    clear()
    setChat([])
    setDraft("")
    setImage(null)
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
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="min-w-0 truncate font-sebenta text-sm font-semibold text-foreground">
            {form?.title || "New form"}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              onClick={startOver}
              disabled={isLoading}
              className="h-8 px-2.5 text-muted-foreground"
            >
              New
            </Button>
            <Button
              onClick={() =>
                showToast("Saving comes next — persistence is the next step.", { type: "info" })
              }
              disabled={isLoading || !form?.title}
              className="h-8 px-3"
            >
              Save
            </Button>
          </div>
        </div>

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

      <main className="thin-scroll flex-1 overflow-y-auto bg-canvas px-6 py-10 sm:px-10">
        <FormPreview form={form} building={isLoading} />
      </main>
    </div>
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
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-background">
        <Sparkle className="size-3.5" />
      </span>
      {building ? (
        <span className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
          Building your form
          <Dots />
        </span>
      ) : (
        <p className="pt-0.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
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

function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2zM19 14l.8 2.6L22 18l-2.2.8L19 22l-.8-3.2L16 18l2.2-1.4L19 14z" />
    </svg>
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
