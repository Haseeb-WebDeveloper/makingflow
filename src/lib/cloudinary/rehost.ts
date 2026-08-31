import "server-only"

import { createHash } from "node:crypto"
import { CLOUDINARY_FOLDERS, type CloudinaryFolder } from "@/lib/cloudinary/config"

/**
 * Copying someone else's hosted file onto our Cloudinary account.
 *
 * The migration case: a form imported from Tally keeps pointing at
 * storage.tally.so for its logo, its inline images and every CV a respondent
 * uploaded. That is fine right up until the day the Tally account is closed,
 * at which point all of it turns into dead links — and the responses we
 * imported are the record of people's job applications, so "dead links" means
 * losing the applications.
 *
 * Cloudinary will fetch a remote URL itself when you pass it as `file`, so this
 * never downloads or buffers the asset: we hand over a URL and get back a
 * delivery URL. That matters at this scale — one account here has 13,490
 * submissions.
 *
 * Signed rather than unsigned (unlike ./upload.ts, which runs in the browser):
 * remote-URL fetching is a privileged operation, and we already hold the secret
 * server-side for deletes.
 */

/** Hosts we will ask Cloudinary to fetch from. */
const ALLOWED_HOSTS = new Set(["storage.tally.so", "tally.so", "www.tally.so"])

const TIMEOUT_MS = 60_000

export type RehostedAsset = {
  publicId: string
  secureUrl: string
  bytes: number
  mimeType: string
  fileName: string
}

function creds() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/**
 * Is this a URL we would re-host?
 *
 * Host-locked for the same reason the importer's fetcher is: the URL comes from
 * data we did not author. An open list would turn this into a free image proxy
 * running on our Cloudinary quota, fetching whatever anyone could get into a
 * form definition.
 */
export function isRehostable(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Already ours — re-hosting it again would just duplicate the asset. */
export function isOurs(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("res.cloudinary.com")
}

const MIME_BY_FORMAT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
}

/**
 * Cloudinary's `resource_type`/`format` back into a mime type.
 *
 * Stored because `resourceTypeFromMime` (./delete.ts) reads it back to decide
 * which bucket to destroy from — get it wrong and the asset outlives the row.
 */
function mimeOf(resourceType: string, format: string): string {
  const known = MIME_BY_FORMAT[format?.toLowerCase()]
  if (known) return known
  if (resourceType === "image") return `image/${format || "png"}`
  if (resourceType === "video") return `video/${format || "mp4"}`
  return "application/octet-stream"
}

/** The name a person would recognise, from the tail of the source URL. */
function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop()
    return last ? decodeURIComponent(last).slice(0, 200) : "file"
  } catch {
    return "file"
  }
}

/**
 * Copy one remote asset onto our account.
 *
 * Returns null rather than throwing when it cannot be done, because this runs
 * over thousands of files and one 404 on a single CV must not abort a
 * migration. The caller counts failures and reports them.
 */
export async function rehostFromUrl(
  url: string,
  folder: CloudinaryFolder,
): Promise<RehostedAsset | null> {
  const c = creds()
  if (!c) {
    console.warn("[rehost] Cloudinary credentials missing — leaving the asset where it is")
    return null
  }
  if (!isRehostable(url)) return null

  const timestamp = Math.floor(Date.now() / 1000)
  const folderPath = CLOUDINARY_FOLDERS[folder]

  // Cloudinary signs every parameter except file, cloud_name, resource_type and
  // api_key, sorted by key and joined with the secret appended.
  const toSign = `folder=${folderPath}&timestamp=${timestamp}`
  const signature = createHash("sha1").update(`${toSign}${c.apiSecret}`).digest("hex")

  const body = new FormData()
  body.append("file", url) // Cloudinary fetches it; we never buffer the bytes
  body.append("folder", folderPath)
  body.append("timestamp", String(timestamp))
  body.append("api_key", c.apiKey)
  body.append("signature", signature)

  let res: Response
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/auto/upload`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return null
  }

  if (!res.ok) {
    // The common case is a source file Tally has already removed. Log the
    // status, never the response body — it echoes the URL we sent.
    console.warn(`[rehost] Cloudinary refused an asset (${res.status})`)
    return null
  }

  let data: Record<string, unknown>
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }

  const publicId = typeof data.public_id === "string" ? data.public_id : ""
  const secureUrl = typeof data.secure_url === "string" ? data.secure_url : ""
  if (!publicId || !secureUrl) return null

  const resourceType = typeof data.resource_type === "string" ? data.resource_type : "raw"
  const format = typeof data.format === "string" ? data.format : ""

  return {
    publicId,
    secureUrl,
    bytes: typeof data.bytes === "number" ? data.bytes : 0,
    mimeType: mimeOf(resourceType, format),
    fileName: nameFromUrl(url),
  }
}
