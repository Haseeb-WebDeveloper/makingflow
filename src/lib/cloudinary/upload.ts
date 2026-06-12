import { CLOUDINARY_FOLDERS, type CloudinaryFolder } from './config'

export type CloudinaryUploadResult = {
  publicId: string
  secureUrl: string
  width: number
  height: number
  format: string
  bytes: number
}

/**
 * Upload a File to Cloudinary using the unsigned upload preset.
 * Runs client-side — sends directly to Cloudinary (no server roundtrip).
 */
export async function uploadToCloudinary(
  file: File,
  folder: CloudinaryFolder
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary environment variables are not configured')
  }

  const body = new FormData()
  body.append('file', file)
  body.append('upload_preset', uploadPreset)
  body.append('folder', CLOUDINARY_FOLDERS[folder])

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    { method: 'POST', body }
  )

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`Cloudinary upload failed: ${text}`)
  }

  const data = await res.json()

  return {
    publicId: data.public_id,
    secureUrl: data.secure_url,
    width: data.width,
    height: data.height,
    format: data.format,
    bytes: data.bytes,
  }
}

/**
 * Upload multiple files in parallel with progress tracking.
 * Returns results in the same order as the input files.
 */
export async function uploadMultipleToCloudinary(
  files: File[],
  folder: CloudinaryFolder,
  onProgress?: (completed: number, total: number) => void
): Promise<CloudinaryUploadResult[]> {
  let completed = 0
  const total = files.length

  const results = await Promise.all(
    files.map(async (file) => {
      const result = await uploadToCloudinary(file, folder)
      completed++
      onProgress?.(completed, total)
      return result
    })
  )

  return results
}
