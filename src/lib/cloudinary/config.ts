export const CLOUDINARY_FOLDERS = {
  avatars: 'makingflow/avatars',
  logos: 'makingflow/logos',
  // Form cover images, branding, and inline content blocks.
  formAssets: 'makingflow/form-assets',
  // Files uploaded by respondents through file-upload fields.
  submissions: 'makingflow/submissions',
  uploads: 'makingflow/uploads',
} as const

export type CloudinaryFolder = keyof typeof CLOUDINARY_FOLDERS

export type UploadResult = {
  publicId: string
  secureUrl: string
  width: number
  height: number
  format: string
  bytes: number
  originalFilename: string
}

/**
 * Extract a consistent UploadResult from the raw Cloudinary widget response.
 * The widget returns a large info object — this picks only what we store.
 */
export function parseWidgetResult(info: Record<string, unknown>): UploadResult {
  return {
    publicId: info.public_id as string,
    secureUrl: info.secure_url as string,
    width: info.width as number,
    height: info.height as number,
    format: info.format as string,
    bytes: info.bytes as number,
    originalFilename: info.original_filename as string,
  }
}
