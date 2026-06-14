'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, X, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { showToast } from '@/components/ui/toast'

export type StagedFile = {
  file: File
  previewUrl: string
  id: string
}

interface LocalFilePickerProps {
  accept?: string
  maxFiles?: number
  maxSizeMB?: number
  files: StagedFile[]
  onFilesChange: (files: StagedFile[]) => void
  label?: string
  description?: string
  className?: string
  compact?: boolean
}

let fileIdCounter = 0
function nextFileId() {
  return `file-${++fileIdCounter}-${Date.now()}`
}

function isImageFile(file: File) {
  return file.type.startsWith('image/')
}

export function LocalFilePicker({
  accept = 'image/*',
  maxFiles = 10,
  maxSizeMB = 10,
  files,
  onFilesChange,
  label = 'Upload files',
  description,
  className,
  compact = false,
}: LocalFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const maxSizeBytes = maxSizeMB * 1024 * 1024

  useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    }
    // Only revoke on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const newFiles: StagedFile[] = []
      const remaining = maxFiles - files.length

      if (remaining <= 0) {
        showToast(`Maximum ${maxFiles} files allowed`, { type: 'warning' })
        return
      }

      const list = Array.from(incoming).slice(0, remaining)

      for (const file of list) {
        if (file.size > maxSizeBytes) {
          showToast(`${file.name} exceeds ${maxSizeMB}MB limit`, {
            type: 'error',
          })
          continue
        }
        newFiles.push({
          file,
          previewUrl: URL.createObjectURL(file),
          id: nextFileId(),
        })
      }

      if (newFiles.length > 0) {
        onFilesChange([...files, ...newFiles])
      }
    },
    [files, maxFiles, maxSizeBytes, maxSizeMB, onFilesChange]
  )

  const removeFile = useCallback(
    (id: string) => {
      const target = files.find((f) => f.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      onFilesChange(files.filter((f) => f.id !== id))
    },
    [files, onFilesChange]
  )

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }

  const canAddMore = files.length < maxFiles

  return (
    <div className={cn('space-y-3 lg:space-y-[0.833vw]', className)}>
      {canAddMore && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg lg:rounded-[0.694vw] border-2 border-dashed transition-colors',
            compact ? 'gap-1 lg:gap-[0.278vw] px-4 lg:px-[1.111vw] py-4 lg:py-[1.111vw]' : 'gap-2 lg:gap-[0.556vw] px-6 lg:px-[1.667vw] py-8 lg:py-[2.222vw]',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-accent/50'
          )}
        >
          <Upload
            className={cn(
              'text-muted-foreground',
              compact ? 'size-5 lg:size-[1.389vw]' : 'size-6 lg:size-[1.667vw]'
            )}
          />
          <p
            className={cn(
              'font-medium text-foreground',
              compact ? 'text-xs lg:text-[0.833vw]' : 'text-sm lg:text-[0.972vw]'
            )}
          >
            {label}
          </p>
          {description && (
            <p className="text-xs lg:text-[0.833vw] text-muted-foreground text-center">
              {description}
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={maxFiles > 1}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
            className="hidden"
          />
        </div>
      )}

      {files.length > 0 && (
        <div
          className={cn(
            'grid gap-2 lg:gap-[0.556vw]',
            compact ? 'grid-cols-2' : 'grid-cols-3 sm:grid-cols-4'
          )}
        >
          {files.map((staged) => (
            <div
              key={staged.id}
              className="group relative aspect-square overflow-hidden rounded-md lg:rounded-[0.556vw] border border-border bg-muted"
            >
              {isImageFile(staged.file) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={staged.previewUrl}
                  alt={staged.file.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 lg:gap-[0.278vw] p-2 lg:p-[0.556vw]">
                  <FileText className="size-8 lg:size-[2.222vw] text-muted-foreground" />
                  <span className="text-[10px] lg:text-[0.694vw] text-muted-foreground truncate max-w-full">
                    {staged.file.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(staged.id)}
                className="absolute right-1 lg:right-[0.278vw] top-1 lg:top-[0.278vw] rounded-full bg-background/80 p-0.5 lg:p-[0.139vw] opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Remove ${staged.file.name}`}
              >
                <X className="size-3.5 lg:size-[0.972vw] text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
