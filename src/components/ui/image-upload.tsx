'use client'

import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { showToast } from '@/components/ui/toast'
import { uploadToCloudinary } from '@/lib/cloudinary/upload'
import { type CloudinaryFolder, type UploadResult } from '@/lib/cloudinary/config'
import { cn } from '@/lib/utils'

type ImageUploadAccept = 'image' | 'image+pdf'

// Native file-picker accept lists — opening the OS picker directly (and on
// mobile, the camera) rather than the Cloudinary widget UI.
const ACCEPT_ATTR: Record<ImageUploadAccept, string> = {
  image: 'image/png,image/jpeg,image/webp',
  'image+pdf': 'image/png,image/jpeg,image/webp,application/pdf',
}

interface ImageUploadProps {
  folder: CloudinaryFolder
  onUpload: (result: UploadResult) => void
  maxFiles?: number
  accept?: ImageUploadAccept
  maxFileSize?: number
  className?: string
  children?: React.ReactNode
}

export function ImageUpload({
  folder,
  onUpload,
  maxFiles = 1,
  accept = 'image',
  maxFileSize = 10_485_760,
  className,
  children,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  function pick() {
    if (uploading) return
    inputRef.current?.click()
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList).slice(0, maxFiles)
    setUploading(true)
    try {
      // Sequential so onUpload fires in the picked order (callers may treat the
      // first as a cover image).
      for (const file of files) {
        if (file.size > maxFileSize) {
          showToast(
            `${file.name} is too large (max ${Math.round(maxFileSize / 1_048_576)}MB).`,
            { type: 'error' },
          )
          continue
        }
        try {
          const r = await uploadToCloudinary(file, folder)
          onUpload({ ...r, originalFilename: file.name })
        } catch (err) {
          console.error('[ImageUpload] upload failed', err)
          showToast(`Couldn't upload ${file.name}. Please try again.`, {
            type: 'error',
          })
        }
      }
    } finally {
      setUploading(false)
      // Reset so picking the same file again still fires onChange.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={cn('inline-flex', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR[accept]}
        multiple={maxFiles > 1}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {children ? (
        <button
          type="button"
          onClick={pick}
          disabled={uploading}
          className="relative disabled:cursor-not-allowed disabled:opacity-70"
        >
          {children}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center rounded-md lg:rounded-[0.556vw] bg-background/60">
              <Spinner />
            </span>
          )}
        </button>
      ) : (
        <Button type="button" variant="outline" onClick={pick} disabled={uploading}>
          {uploading ? (
            <Spinner />
          ) : (
            <Upload className="size-4 lg:size-[1.111vw]" />
          )}
          {uploading ? 'Uploading…' : maxFiles > 1 ? 'Upload files' : 'Upload'}
        </Button>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="block size-4 lg:size-[1.111vw] animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70"
    />
  )
}

interface UploadedImagePreviewProps {
  url: string
  alt?: string
  onRemove?: () => void
  className?: string
}

export function UploadedImagePreview({
  url,
  alt = 'Uploaded image',
  onRemove,
  className,
}: UploadedImagePreviewProps) {
  return (
    <div
      className={cn(
        'group relative h-24 lg:h-[6.667vw] w-24 lg:w-[6.667vw] overflow-hidden rounded-md lg:rounded-[0.556vw] border border-border',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="h-full w-full object-cover" />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 lg:right-[0.278vw] top-1 lg:top-[0.278vw] rounded-full bg-background/80 p-0.5 lg:p-[0.139vw] opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Remove image"
        >
          <X className="size-3.5 lg:size-[0.972vw] text-destructive" />
        </button>
      )}
    </div>
  )
}
