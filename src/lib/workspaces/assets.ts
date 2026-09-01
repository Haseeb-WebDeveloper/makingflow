import 'server-only'

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  customDomains,
  formChatMessages,
  formFields,
  forms,
  uploads,
  workspaces,
  type FieldConfig,
} from '@/lib/db/schema'
import { assetFromUrl, resourceTypeFromMime, type CloudinaryAsset } from '@/lib/cloudinary/delete'

/**
 * Everything a workspace owns that outlives its rows.
 *
 * Deleting a workspace is one `DELETE` — every FK that references it is
 * ON DELETE CASCADE. That is exactly the problem: the cascade takes the rows
 * holding the Cloudinary `public_id`s with it, so anything not collected FIRST
 * becomes unreachable bytes we pay for forever. `uploads` is the big one
 * (`uploads.workspace_id` cascades), and it is invisible from the form side.
 *
 * Returns the form ids and domains too, because the caller needs them after the
 * rows are gone — form ids to flush the public runtime's per-form cache tags,
 * domains to deregister from Vercel.
 */

/**
 * Ceiling on collected assets. A large tenant can hold tens of thousands of
 * respondent uploads, and neither the query nor the subsequent destroy fan-out
 * should grow without bound. Past the cap we log and proceed: orphaned bytes
 * cost storage, but refusing to delete the workspace would deny the user a
 * deletion they are entitled to. (A per-workspace Cloudinary folder would turn
 * this into one prefix delete; the folders are global today.)
 */
const MAX_COLLECTED_ASSETS = 10_000

const CLOUDINARY_URL_RE = /https:\/\/res\.cloudinary\.com\/[^\s)"']+/g

export type WorkspaceAssets = {
  assets: CloudinaryAsset[]
  forms: { id: string }[]
  domains: { domain: string }[]
}

export async function collectWorkspaceAssets(workspaceId: string): Promise<WorkspaceAssets> {
  const [workspaceRow, formRows, uploadRows, domainRows] = await Promise.all([
    db
      .select({ logoUrl: workspaces.logoUrl })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1),
    db
      .select({ id: forms.id, theme: forms.theme, settings: forms.settings })
      .from(forms)
      .where(eq(forms.workspaceId, workspaceId)),
    db
      .select({ storageKey: uploads.storageKey, mimeType: uploads.mimeType })
      .from(uploads)
      .where(eq(uploads.workspaceId, workspaceId))
      .limit(MAX_COLLECTED_ASSETS),
    db
      .select({ domain: customDomains.domain })
      .from(customDomains)
      .where(eq(customDomains.workspaceId, workspaceId)),
  ])

  const formIds = formRows.map((f) => f.id)

  // Field image blocks and AI-thread screenshots hang off forms, not the
  // workspace, so they need the form ids first.
  const [fieldRows, chatRows] =
    formIds.length > 0
      ? await Promise.all([
          db
            .select({ config: formFields.config })
            .from(formFields)
            .where(inArray(formFields.formId, formIds)),
          db
            .select({ imageUrl: formChatMessages.imageUrl })
            .from(formChatMessages)
            .where(inArray(formChatMessages.formId, formIds)),
        ])
      : [[], []]

  const urls: (string | null | undefined)[] = [
    workspaceRow[0]?.logoUrl,
    ...formRows.flatMap((f) => [
      f.theme?.logoUrl,
      f.theme?.coverImageUrl,
      f.settings?.successVideoUrl,
      // Success-page body is HTML authored in the builder; images live inline.
      ...((f.settings?.successBody ?? '').match(CLOUDINARY_URL_RE) ?? []),
    ]),
    ...fieldRows.map((f) => (f.config as FieldConfig | null)?.imageUrl),
    ...chatRows.map((c) => c.imageUrl),
  ]

  const assets: CloudinaryAsset[] = [
    // Respondent uploads carry their public_id directly — no URL parsing needed.
    ...uploadRows.map((u) => ({
      publicId: u.storageKey,
      resourceType: resourceTypeFromMime(u.mimeType),
    })),
    ...urls.map((url) => assetFromUrl(url)).filter((a): a is CloudinaryAsset => a !== null),
  ]

  if (assets.length >= MAX_COLLECTED_ASSETS) {
    console.error(
      `[collectWorkspaceAssets] ${workspaceId} hit the ${MAX_COLLECTED_ASSETS} asset cap — some Cloudinary assets will be orphaned`,
    )
  }

  return { assets, forms: formRows.map((f) => ({ id: f.id })), domains: domainRows }
}
