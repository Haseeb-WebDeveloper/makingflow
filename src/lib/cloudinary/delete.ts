import "server-only"

import { createHash } from "node:crypto"

/**
 * Server-side Cloudinary asset deletion (right-to-erasure / storage reclaim).
 *
 * Uploads happen client-side via an unsigned preset (`./upload.ts`), so deletes
 * are the only Cloudinary path that needs our secret. We hand-roll the signed
 * `destroy` call with `fetch` + a SHA-1 signature (no SDK dependency — same
 * raw-HTTP style as the upload path).
 *
 * Graceful by design: if credentials are missing we log and no-op so a DB
 * delete that already committed is never rolled back by a Cloudinary outage.
 * Callers should treat asset destruction as best-effort and run it post-commit.
 */

// Cloudinary classifies every asset as one of these; `destroy` must target the
// right one or it returns "not found". We derive it from the stored mime type,
// then fall back to the others for legacy rows that guessed wrong.
type ResourceType = "image" | "video" | "raw"
const ALL_RESOURCE_TYPES: ResourceType[] = ["image", "video", "raw"]

export type CloudinaryAsset = {
  publicId: string
  resourceType?: ResourceType
}

function creds() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/** Map a stored mime type to Cloudinary's resource_type bucket. */
export function resourceTypeFromMime(mime?: string | null): ResourceType {
  if (!mime) return "raw"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "video"
  return "raw"
}

/**
 * Extract `{ publicId, resourceType }` from a Cloudinary delivery URL (used for
 * assets we only store as a URL — logo, cover image, inline image blocks).
 * Returns null for non-Cloudinary or unparseable URLs (caller skips them).
 */
export function assetFromUrl(url?: string | null): CloudinaryAsset | null {
  if (!url) return null
  // .../res.cloudinary.com/<cloud>/<resourceType>/<deliveryType>/<rest...>
  const m = url.match(/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/[^/]+\/(.+)$/)
  if (!m) return null
  const resourceType = m[1] as ResourceType
  let rest = m[2]
  rest = rest.replace(/^v\d+\//, "") // strip version segment (v1700000000/)
  rest = rest.replace(/\.[^./]+$/, "") // strip file extension
  if (!rest) return null
  return { publicId: rest, resourceType }
}

async function destroyOne(
  c: NonNullable<ReturnType<typeof creds>>,
  publicId: string,
  resourceType: ResourceType,
): Promise<"ok" | "not found" | "error"> {
  const timestamp = Math.floor(Date.now() / 1000)
  // Sign every param except api_key/signature/resource_type/file, sorted alpha.
  const toSign = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}`
  const signature = createHash("sha1").update(toSign + c.apiSecret).digest("hex")

  const body = new FormData()
  body.append("public_id", publicId)
  body.append("timestamp", String(timestamp))
  body.append("invalidate", "true")
  body.append("api_key", c.apiKey)
  body.append("signature", signature)

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${c.cloudName}/${resourceType}/destroy`,
      { method: "POST", body },
    )
    if (!res.ok) return "error"
    const data = (await res.json()) as { result?: string }
    if (data.result === "ok") return "ok"
    if (data.result === "not found") return "not found"
    return "error"
  } catch {
    return "error"
  }
}

/**
 * Permanently delete one Cloudinary asset (and purge its CDN cache). Tries the
 * derived resource_type first, then the remaining types if the asset isn't
 * found there. Best-effort: returns true on success, false otherwise.
 */
export async function destroyAsset(asset: CloudinaryAsset): Promise<boolean> {
  const c = creds()
  if (!c) {
    console.error("[cloudinary] destroy skipped — credentials not configured")
    return false
  }
  if (!asset.publicId) return false

  const order: ResourceType[] = asset.resourceType
    ? [asset.resourceType, ...ALL_RESOURCE_TYPES.filter((t) => t !== asset.resourceType)]
    : ALL_RESOURCE_TYPES

  for (const type of order) {
    const result = await destroyOne(c, asset.publicId, type)
    if (result === "ok") return true
    if (result === "not found") continue // wrong bucket — try the next type
    // "error" on the derived type: still try the others before giving up.
  }
  console.error(`[cloudinary] destroy failed for ${asset.publicId}`)
  return false
}

/** Destroy many assets concurrently; never throws (best-effort cleanup). */
export async function destroyAssets(assets: CloudinaryAsset[]): Promise<void> {
  const unique = new Map(assets.filter((a) => a?.publicId).map((a) => [a.publicId, a]))
  if (unique.size === 0) return
  await Promise.allSettled([...unique.values()].map((a) => destroyAsset(a)))
}
