"use client"

import { useRef, useState } from "react"
import { SuccessContent } from "@/components/forms/success-content"
import { uploadToCloudinary } from "@/lib/cloudinary/upload"
import { showToast } from "@/components/ui/toast"

export type SuccessPage = { title: string; body: string; videoUrl: string | null }

const DEFAULT_TITLE = "Thanks! Your response has been recorded."

/**
 * Canvas editor for the post-submit success page: a title, a markdown body
 * (with a light toolbar + image upload), an optional uploaded video, and a live
 * preview. Saves through the builder's debounced settings lane.
 */
export function SuccessPageEditor({
  value,
  onChange,
}: {
  value: SuccessPage
  onChange: (next: SuccessPage) => void
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<"image" | "video" | null>(null)

  /** Wrap the current selection (or insert a placeholder) with markdown syntax. */
  function wrap(before: string, after = before, placeholder = "text") {
    const el = bodyRef.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const v = value.body
    const sel = v.slice(s, e) || placeholder
    const next = v.slice(0, s) + before + sel + after + v.slice(e)
    onChange({ ...value, body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = s + before.length
      el.selectionEnd = s + before.length + sel.length
    })
  }

  /** Insert a prefix at the start of the current line (headings, lists). */
  function linePrefix(prefix: string) {
    const el = bodyRef.current
    if (!el) return
    const v = value.body
    const s = el.selectionStart
    const lineStart = v.lastIndexOf("\n", s - 1) + 1
    const next = v.slice(0, lineStart) + prefix + v.slice(lineStart)
    onChange({ ...value, body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = s + prefix.length
    })
  }

  function insertAtCursor(text: string) {
    const el = bodyRef.current
    const v = value.body
    const at = el ? el.selectionStart : v.length
    onChange({ ...value, body: v.slice(0, at) + text + v.slice(at) })
  }

  async function uploadImage(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", { type: "error" })
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("That image is too large (max 8MB).", { type: "error" })
      return
    }
    setUploading("image")
    try {
      const r = await uploadToCloudinary(file, "formAssets")
      insertAtCursor(`\n\n![](${r.secureUrl})\n\n`)
    } catch {
      showToast("Couldn't upload that image. Please try again.", { type: "error" })
    } finally {
      setUploading(null)
    }
  }

  async function uploadVideo(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith("video/")) {
      showToast("Please choose a video file.", { type: "error" })
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      showToast("That video is too large (max 100MB).", { type: "error" })
      return
    }
    setUploading("video")
    try {
      const r = await uploadToCloudinary(file, "formAssets")
      onChange({ ...value, videoUrl: r.secureUrl })
    } catch {
      showToast("Couldn't upload that video. Please try again.", { type: "error" })
    } finally {
      setUploading(null)
    }
  }

  const hasPreview = Boolean(value.body || value.videoUrl)

  return (
    <div className="mt-10 rounded-xl border border-border p-4">
      <p className="mb-3 text-sm font-semibold text-foreground">After submit</p>

      <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
      <input
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        placeholder={DEFAULT_TITLE}
        className="mb-4 w-full rounded-md border border-input bg-input/30 px-3 py-2 font-sebenta text-base font-semibold text-foreground outline-none placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-foreground/40"
      />

      <label className="mb-1 block text-xs font-medium text-muted-foreground">Message</label>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <TBtn label="B" title="Bold" onClick={() => wrap("**")} className="font-bold" />
        <TBtn label="I" title="Italic" onClick={() => wrap("_")} className="italic" />
        <TBtn label="H" title="Heading" onClick={() => linePrefix("## ")} />
        <TBtn label="•" title="List" onClick={() => linePrefix("- ")} />
        <TBtn label="Link" title="Link" onClick={() => wrap("[", "](https://)", "label")} />
        <TBtn
          label={uploading === "image" ? "…" : "Image"}
          title="Insert image"
          onClick={() => imageRef.current?.click()}
          disabled={uploading !== null}
        />
        <TBtn
          label={uploading === "video" ? "…" : value.videoUrl ? "Replace video" : "Video"}
          title="Upload video"
          onClick={() => videoRef.current?.click()}
          disabled={uploading !== null}
        />
        {value.videoUrl ? (
          <TBtn
            label="Remove video"
            title="Remove video"
            onClick={() => onChange({ ...value, videoUrl: null })}
            className="text-destructive"
          />
        ) : null}
      </div>
      <textarea
        ref={bodyRef}
        rows={4}
        value={value.body}
        onChange={(e) => onChange({ ...value, body: e.target.value })}
        placeholder="Add a message, links, or images shown after submitting. Markdown supported."
        className="thin-scroll w-full resize-y rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
      />

      {hasPreview ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-canvas px-4 py-5 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <SuccessContent body={value.body} videoUrl={value.videoUrl} />
        </div>
      ) : null}

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          void uploadImage(f)
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          void uploadVideo(f)
        }}
      />
    </div>
  )
}

function TBtn({
  label,
  title,
  onClick,
  disabled,
  className,
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 " +
        (className ?? "")
      }
    >
      {label}
    </button>
  )
}
