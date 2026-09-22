import "server-only"

/**
 * "Give me every CV in one zip" — the reason this feature exists for anyone
 * hiring.
 *
 * CLOUDINARY BUILDS THE ZIP, WE DO NOT. `generate_archive` takes a list of
 * public ids and returns a stored archive's URL synchronously; the bytes never
 * pass through us. The alternative — fetching two hundred PDFs and streaming
 * them into an archive inside a 60-second route — is one HTTP call versus two
 * hundred, and would put every respondent's file through our egress for no
 * gain. It is also what lets this ship without the export queue: the only slow
 * part left is scanning the scope for assets.
 *
 * ENTRIES ARE NAMED BY PUBLIC ID, and that is a considered choice rather than a
 * limitation we failed to notice. Cloudinary cannot name entries per file, and
 * `use_original_filename` is worse than it looks: two hundred respondents all
 * uploading `resume.pdf` collide inside one zip, and a collision inside an
 * archive is a file that silently is not there. Public ids are unique by
 * construction, and the `Files` column in the data export carries each
 * submission's exact entry name — so the two halves refer to each other.
 *
 * ONE ARCHIVE PER RESOURCE TYPE, SPLIT AT 1000 ASSETS. `resource_type` is part
 * of the endpoint path, so images and raw files cannot go in one call — and
 * Cloudinary treats a PDF as an image and a .docx as raw, so a form collecting
 * both legitimately produces two archives. 1000 is Cloudinary's own per-archive
 * ceiling, not ours.
 */

import { createHash } from "node:crypto"
import { assetFromUrl, resourceTypeFromMime } from "@/lib/cloudinary/delete"
import type { ExportSource } from "@/lib/submissions/export-query"

/** Cloudinary's documented maximum assets in one archive. */
export const ARCHIVE_ASSET_LIMIT = 1000

/**
 * Cloudinary's archive size ceiling, for the message we show when it is hit.
 * The API's own error is not something to put in front of a form owner.
 */
export const ARCHIVE_SIZE_NOTE = "100 MB"

const TIMEOUT_MS = 55_000

export type ResourceType = "image" | "video" | "raw"
export type MediaAsset = {
  publicId: string
  resourceType: ResourceType
  /** Lower-case extension without the dot, for naming the archive's contents. */
  ext: string
}
export type ArchiveGroup = {
  resourceType: ResourceType
  publicIds: string[]
  /** Distinct file types inside, upper-case: ["PDF"], ["DOCX", "DOC"]. */
  formats: string[]
}

export type MediaArchive = {
  name: string
  /** A URL that downloads rather than displays. */
  url: string
  /** Files actually in the archive, as Cloudinary counted them. */
  fileCount: number
  /** Files we asked for. Higher than `fileCount` means storage lost some. */
  requested: number
  bytes: number
  /**
   * What is inside, for a label a person can read.
   *
   * NOT the Cloudinary resource type. An archive is split by that — and
   * Cloudinary files a PDF under `image` — so "Images" on a zip of resumes
   * would be actively misleading. The file types are the honest answer.
   */
  formats: string[]
}

function creds() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/**
 * What one file is called inside the archive.
 *
 * Verified against the real API rather than assumed, because the two asset
 * kinds behave differently and guessing produces wrong names:
 *
 *   - A RAW asset's public id already carries its extension
 *     (`makingflow/submissions/ab12.docx`), and the entry is exactly that
 *     id's last segment. Appending an extension here would produce
 *     `ab12.docx.docx`.
 *   - An IMAGE asset's public id has none (`.../ab12`) — a PDF is an image to
 *     Cloudinary — and it appends its own stored format, giving `ab12.pdf`.
 *
 * So the extension comes from the delivery URL when the id lacks one: that URL
 * ends in the format Cloudinary actually stored, which is a better source than
 * the respondent's filename (someone uploading `photo.jpeg` gets a `.jpg`
 * asset). The filename is the last resort.
 *
 * Folders are flattened (`flatten_folders=true` below). Every submission file
 * lives in one folder under a random id, so flattening cannot collide.
 */
export function archiveEntryName(
  storageKey: string,
  uploadedName: string,
  deliveryUrl?: string,
): string {
  const base = storageKey.split("/").pop() || storageKey
  if (base.includes(".")) return base
  const ext = assetExtension(storageKey, uploadedName, deliveryUrl)
  return ext ? `${base}.${ext}` : base
}

/** The extension an archived file will actually have, without the dot. */
export function assetExtension(
  storageKey: string,
  uploadedName: string,
  deliveryUrl?: string,
): string {
  const fromKey = extension(storageKey.split("/").pop())
  if (fromKey) return fromKey
  return extension(deliveryUrl?.split("?")[0]?.split("/").pop()) || extension(uploadedName)
}

function extension(name: string | undefined): string {
  if (!name) return ""
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * A short, filesystem-safe stem for a download.
 *
 * CAPPED, because form titles are long: "Meta Paid Advertising Specialist —
 * Application & Screening Form" produced an eighty-character filename that
 * overflowed its own dialog and told a person nothing the dialog had not
 * already said.
 */
export function archiveSlug(formTitle: string, max = 32): string {
  const slug = formTitle
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
  if (!slug) return "form"
  // Cut at a word boundary where there is one nearby, so the stem stays
  // readable rather than ending mid-word.
  if (slug.length <= max) return slug
  const cut = slug.slice(0, max)
  const lastDash = cut.lastIndexOf("-")
  return (lastDash > max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "")
}

/**
 * Turn a delivery URL into one that saves to disk under a readable name.
 *
 * Without `fl_attachment` a browser may render the archive's URL rather than
 * download it, and the saved file is named after the random public id.
 * A non-Cloudinary URL is returned untouched rather than mangled.
 */
export function attachmentUrl(url: string, downloadName: string): string {
  const marker = "/upload/"
  const at = url.indexOf(marker)
  if (!url.includes("res.cloudinary.com") || at === -1) return url
  const safe = downloadName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "files"
  return `${url.slice(0, at + marker.length)}fl_attachment:${safe}/${url.slice(at + marker.length)}`
}

/**
 * Which Cloudinary bucket an asset lives in.
 *
 * THE DELIVERY URL DECIDES, NOT THE MIME TYPE. Cloudinary files a PDF under
 * `image`, but its mime type is `application/pdf`, so guessing from the mime
 * sends every resume to `/raw/generate_archive` — where it does not exist. With
 * `allow_missing=true` that is not an error: the archive simply comes back
 * without them. On one real form that silently dropped 12 of 22 files.
 *
 * The URL carries the bucket Cloudinary actually chose
 * (`/res.cloudinary.com/<cloud>/image/upload/...`), which is ground truth. The
 * mime type is the fallback for a row whose URL we cannot parse.
 */
function resourceTypeFor(file: { url: string; mime?: string }): ResourceType {
  return (assetFromUrl(file.url)?.resourceType ?? resourceTypeFromMime(file.mime)) as ResourceType
}

/**
 * The public id to archive.
 *
 * `storageKey` is authoritative when the upload recorded one. Otherwise the URL
 * is parsed — but `assetFromUrl` strips the extension, which is right for an
 * image (whose public id has none) and wrong for a raw asset (whose public id
 * ends in `.docx`), so it is put back for that bucket.
 */
function publicIdFor(file: { url: string; storageKey?: string }, resourceType: ResourceType) {
  if (file.storageKey) return file.storageKey
  const parsed = assetFromUrl(file.url)
  if (!parsed?.publicId) return null
  if (resourceType !== "raw") return parsed.publicId
  const ext = extension(file.url.split("?")[0]?.split("/").pop())
  return ext ? `${parsed.publicId}.${ext}` : parsed.publicId
}

/** Every archivable asset in scope, de-duplicated, in encounter order. */
export async function collectAssets(source: ExportSource): Promise<MediaAsset[]> {
  const seen = new Map<string, MediaAsset>()
  for await (const sub of source.rows) {
    for (const f of sub.files) {
      const resourceType = resourceTypeFor(f)
      const publicId = publicIdFor(f, resourceType)
      // A file on somebody else's CDN — an import — is skipped: we cannot
      // archive what we do not host, and one such file must not fail the
      // whole export.
      if (!publicId) continue
      if (!seen.has(publicId)) {
        seen.set(publicId, {
          publicId,
          resourceType,
          ext: assetExtension(publicId, f.name, f.url),
        })
      }
    }
  }
  return [...seen.values()]
}

/** Split into per-resource-type calls, each within Cloudinary's asset ceiling. */
export function groupByResourceType(assets: MediaAsset[]): ArchiveGroup[] {
  const buckets = new Map<ResourceType, MediaAsset[]>()
  for (const a of assets) {
    const list = buckets.get(a.resourceType) ?? []
    list.push(a)
    buckets.set(a.resourceType, list)
  }
  const groups: ArchiveGroup[] = []
  for (const [resourceType, bucket] of buckets) {
    for (let i = 0; i < bucket.length; i += ARCHIVE_ASSET_LIMIT) {
      const slice = bucket.slice(i, i + ARCHIVE_ASSET_LIMIT)
      groups.push({
        resourceType,
        publicIds: slice.map((a) => a.publicId),
        formats: [...new Set(slice.map((a) => a.ext).filter(Boolean))].sort().map((e) => e.toUpperCase()),
      })
    }
  }
  return groups
}

/** Raised for the cases a form owner can act on. */
export class MediaArchiveError extends Error {}

/** One `generate_archive` call. */
async function createArchive(group: ArchiveGroup, name: string): Promise<MediaArchive> {
  const c = creds()
  if (!c) throw new MediaArchiveError("File downloads are not configured on this deployment.")

  const timestamp = Math.floor(Date.now() / 1000)
  // Cloudinary signs every parameter except file, cloud_name, resource_type and
  // api_key, sorted by key, with the secret appended.
  const params: Record<string, string> = {
    // Kept true so one file purged from storage cannot fail a recruiter's whole
    // download — but see the file_count check below, which is what stops that
    // leniency from hiding a loss.
    allow_missing: "true",
    flatten_folders: "true",
    mode: "create",
    public_ids: group.publicIds.join(","),
    target_format: "zip",
    target_public_id: `makingflow/exports/${name}`,
    timestamp: String(timestamp),
  }
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&")
  const signature = createHash("sha1").update(`${toSign}${c.apiSecret}`).digest("hex")

  const body = new FormData()
  for (const [k, v] of Object.entries(params)) {
    // THE SIGNATURE USES THE COMMA-JOINED VALUE, THE REQUEST USES `public_ids[]`.
    // Sending one comma-joined field is read as a SINGLE literal public id that
    // matches nothing, and with allow_missing that came back as a cheerful
    // 200 holding a 22-byte empty zip. Verified against the live API: repeated
    // `public_ids[]` entries return the right file_count, comma-joined returns
    // zero (or "Missing public_ids" when allow_missing is off).
    if (k === "public_ids") {
      for (const id of group.publicIds) body.append("public_ids[]", id)
    } else {
      body.append(k, v)
    }
  }
  body.append("api_key", c.apiKey)
  body.append("signature", signature)

  let res: Response
  try {
    res = await fetch(
      `https://api.cloudinary.com/v1_1/${c.cloudName}/${group.resourceType}/generate_archive`,
      { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
  } catch {
    throw new MediaArchiveError("Building the archive timed out. Try a smaller date range.")
  }

  if (!res.ok) {
    // Never log or surface the response body: it lists respondent file ids.
    console.error(`[export] Cloudinary refused an archive (${res.status})`)
    if (res.status === 400) {
      throw new MediaArchiveError(
        `These files are too large to put in one archive (the limit is ${ARCHIVE_SIZE_NOTE}). Export a narrower range.`,
      )
    }
    throw new MediaArchiveError("The archive could not be built. Please try again.")
  }

  const data = (await res.json()) as Record<string, unknown>
  const url = typeof data.secure_url === "string" ? data.secure_url : ""
  if (!url) throw new MediaArchiveError("The archive was built but came back without a link.")

  const fileCount = typeof data.file_count === "number" ? data.file_count : group.publicIds.length

  // An empty archive is always our bug, never a legitimate outcome: the caller
  // only reaches here with assets it found. Refuse rather than hand over a
  // 22-byte zip that looks like an answer.
  if (fileCount === 0) {
    throw new MediaArchiveError("The archive came back empty. Nothing was downloaded.")
  }

  return {
    name: `${name}.zip`,
    url: attachmentUrl(url, name),
    fileCount,
    // What we asked for, so a caller can tell the owner when storage no longer
    // has every file — `allow_missing` would otherwise swallow that silently.
    requested: group.publicIds.length,
    formats: group.formats,
    bytes: typeof data.bytes === "number" ? data.bytes : 0,
  }
}

export type MediaResult = {
  archives: MediaArchive[]
  /** Distinct files across every archive. */
  fileCount: number
  /** Submissions scanned — how many responses the files came from. */
  rowCount: number
}

/**
 * Build the archives for one export scope.
 *
 * Takes an already-opened source so the files come from exactly the rows the
 * caller scoped, filters included — a ZIP of "the ones I'm looking at" has to
 * mean the same set the CSV of that phrase would.
 */
export async function buildMediaArchives(
  source: ExportSource,
  now: Date,
): Promise<MediaResult> {
  let rowCount = 0
  const counting: ExportSource = {
    ...source,
    rows: (async function* () {
      for await (const row of source.rows) {
        rowCount += 1
        yield row
      }
    })(),
  }

  const assets = await collectAssets(counting)
  if (assets.length === 0) return { archives: [], fileCount: 0, rowCount }

  const slug = archiveSlug(source.form.title)
  const day = now.toISOString().slice(0, 10)
  const groups = groupByResourceType(assets)

  const archives: MediaArchive[] = []
  for (const [i, group] of groups.entries()) {
    // Suffixed only when there is more than one, so the common case is a single
    // plainly-named zip.
    const suffix = groups.length > 1 ? `-${i + 1}` : ""
    archives.push(await createArchive(group, `${slug}-files-${day}${suffix}`))
  }
  return { archives, fileCount: assets.length, rowCount }
}
