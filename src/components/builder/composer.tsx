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
        "rounded-2xl lg:rounded-[1.111vw] border border-border bg-background p-3 lg:p-[0.833vw] transition-colors focus-within:border-foreground/30",
        className,
      )}
    >
      {image ? (
        <div className="mb-2 lg:mb-[0.556vw] flex items-center gap-2.5 lg:gap-[0.694vw] rounded-lg lg:rounded-[0.694vw] border border-border bg-muted/40 p-2 lg:p-[0.556vw] pr-3 lg:pr-[0.833vw]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt=""
            className="size-11 lg:size-[3.056vw] shrink-0 rounded-md lg:rounded-[0.556vw] border border-border object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-sm lg:text-[0.972vw] text-foreground">
            {image.name}
          </span>
          {onRemoveImage ? (
            <button
              type="button"
              onClick={onRemoveImage}
              aria-label="Remove image"
              className="grid size-6 lg:size-[1.667vw] shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault()
            if (canSubmit) onSubmit()
          }
        }}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        style={{ minHeight: `${rows * 1.5}rem`, maxHeight: `${maxRows * 1.5}rem` }}
        className="thin-scroll block w-full resize-none border-0 bg-transparent px-2 lg:px-[0.556vw] pt-1 lg:pt-[0.278vw] text-sm lg:text-[0.972vw] text-foreground outline-none placeholder:text-muted-foreground"
      />

      <div className="flex items-center justify-between pl-1 lg:pl-[0.278vw] pr-0.5 lg:pr-[0.139vw] pt-1.5 lg:pt-[0.417vw]">
        <div className="flex items-center gap-1.5 lg:gap-[0.417vw]">
          {attachable ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a reference image"
              className="grid size-9 lg:size-[2.5vw] place-items-center rounded-lg lg:rounded-[0.694vw] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SVGIcon src="/icons/upload.svg" className="size-5 lg:size-[1.389vw]" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label={submitLabel || "Send"}
          className={cn(
            "flex shrink-0 place-items-center gap-1 lg:gap-[0.278vw] rounded-lg lg:rounded-[0.694vw] bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30",
            submitLabel ? "px-4 lg:px-[1.111vw] py-1.5 lg:py-[0.417vw] font-normal" : "size-9 lg:size-[2.5vw] justify-center",
          )}
        >
          {submitLabel ? <span className="text-sm lg:text-[0.972vw]">{submitLabel}</span> : null}
          <SVGIcon src="/icons/arrow-up.svg" className="size-5 lg:size-[1.389vw]" />
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
