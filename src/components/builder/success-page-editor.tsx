"use client"

import { useEffect, useRef, useState } from "react"
import { RichTextEditor, type RichTextEditorHandle } from "@/components/ui/rich-text-editor"
import { uploadToCloudinary } from "@/lib/cloudinary/upload"
import { showToast } from "@/components/ui/toast"

export type SuccessPage = { title: string; body: string; videoUrl: string | null }

const DEFAULT_TITLE = "Thanks! Your response has been recorded."

/**
 * Canvas editor for the post-submit success page: a title, a Notion-style
 * WYSIWYG body (the body is stored as markdown — see `@/lib/markdown`), and an
 * optional uploaded video. Saves through the builder's debounced settings lane.
 */
export function SuccessPageEditor({
  value,
  onChange,
}: {
  value: SuccessPage
  onChange: (next: SuccessPage) => void
}) {
  const editorRef = useRef<RichTextEditorHandle>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<"image" | "video" | null>(null)

  // Latest value, so the editor's onChange (markdown body) merges with the most
  // recent title/video instead of a stale snapshot captured at mount.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  })

  function onBodyChange(body: string) {
    onChange({ ...valueRef.current, body })
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
      editorRef.current?.insertImage(r.secureUrl)
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
      onChange({ ...valueRef.current, videoUrl: r.secureUrl })
    } catch {
      showToast("Couldn't upload that video. Please try again.", { type: "error" })
    } finally {
      setUploading(null)
    }
  }

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
      <RichTextEditor
        ref={editorRef}
        value={value.body}
        onChange={onBodyChange}
        placeholder="Add a message, links, or images shown after submitting."
        toolbarExtras={
          <>
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
          </>
        }
      />

      {value.videoUrl ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-canvas px-4 py-5">
          <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Video preview
          </p>
          <video
            src={value.videoUrl}
            controls
            playsInline
            className="mx-auto w-full max-w-md rounded-xl border border-border"
          />
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
        "inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 " +
        (className ?? "")
      }
    >
      {label}
    </button>
  )
}
