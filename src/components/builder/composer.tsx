"use client"

import { useEffect, useRef, type ChangeEvent } from "react"
import { SVGIcon } from "@/components/ui/svg-icon"
import { cn } from "@/lib/utils"

export type ComposerImage = { url: string; name: string }

/**
 * The AI composer — used for the first prompt and the in-conversation edit box,
 * so both look identical. Rounded container, thin-scroll textarea, optional
 * image attach (left), submit tucked inside (right).
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  image,
  onRemoveImage,
  onPickFile,
  busy = false,
  submitLabel = "Generate form",
  rows = 5,
  maxRows = 6,
  autoFocus = false,
  animatedBorder = false,
  className,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  image?: ComposerImage | null
  onRemoveImage?: () => void
  onPickFile?: (file: File) => void
  busy?: boolean
  /** Empty string → icon-only round button (compact, for the chat box). */
  submitLabel?: string
  /** Min visible rows (the resting height). */
  rows?: number
  /** Grow with content up to this many rows, then scroll. */
  maxRows?: number
  autoFocus?: boolean
  /** Wrap the box in the moving brand-gradient border (the new-form prompt). */
  animatedBorder?: boolean
  className?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSubmit = !busy && (value.trim() !== "" || Boolean(image))
  const attachable = Boolean(onPickFile)

  // Auto-grow: rest at `rows`, expand with content up to `maxRows`, then scroll.
  // CSS min/max-height bound it; JS sets the exact height to the content.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same file
    if (file) onPickFile?.(file)
  }

  return (
    <div
      className={cn(
        "rounded-2xl bg-background p-3 transition-colors",
        animatedBorder
          ? "gradient-border [--gb-width:4px]"
          : "border border-border focus-within:border-foreground/30",
        className,
      )}
    >
      {image ? (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-2 pr-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt=""
            className="size-11 shrink-0 rounded-md border border-border object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {image.name}
          </span>
          {onRemoveImage ? (
            <button
              type="button"
              onClick={onRemoveImage}
              aria-label="Remove image"
              className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter inserts a newline. Ignore Enter mid-IME
          // composition so confirming a character never submits. Cmd/Ctrl+Enter
          // still sends too, for muscle memory.
          const send =
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing
          if (send || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
            e.preventDefault()
            if (canSubmit) onSubmit()
          }
        }}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        style={{ minHeight: `${rows * 1.5}rem`, maxHeight: `${maxRows * 1.5}rem` }}
        className="thin-scroll block w-full resize-none border-0 bg-transparent px-2 pt-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />

      <div className="flex items-center justify-between pl-1 pr-0.5 pt-1.5">
        <div className="flex items-center gap-1.5">
          {attachable ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a reference image"
              className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SVGIcon src="/icons/upload.svg" className="size-5" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label={submitLabel || "Send"}
          className={cn(
            "flex shrink-0 place-items-center gap-1 rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30",
            submitLabel ? "px-4 py-1.5 font-normal" : "size-9 justify-center",
          )}
        >
          {submitLabel ? <span className="text-sm">{submitLabel}</span> : null}
          <SVGIcon src="/icons/arrow-up.svg" className="size-5" />
        </button>
      </div>

      {attachable ? (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />
      ) : null}
    </div>
  )
}
