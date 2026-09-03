"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ImageUpload } from "@/components/ui/image-upload"
import { WorkspaceAvatar } from "@/components/dashboard/workspace-avatar"
import { showToast } from "@/components/ui/toast"
import { setWorkspaceLogo } from "@/lib/actions/workspaces"

/**
 * The workspace's logo, click-to-replace.
 *
 * The avatar itself is the upload trigger — `ImageUpload` renders whatever it's
 * given as `children` and overlays a spinner while uploading, so there's no
 * separate button to explain. Non-owners get the plain avatar.
 *
 * Note the upload goes browser → Cloudinary directly; `setWorkspaceLogo` only
 * ever receives the resulting URL, and validates it before storing.
 */
export function WorkspaceLogo({
  workspaceId,
  name,
  logoUrl,
  canEdit,
}: {
  workspaceId: string
  name: string
  logoUrl: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()

  if (!canEdit)
    return <WorkspaceAvatar id={workspaceId} name={name} logoUrl={logoUrl} size="lg" />

  function save(url: string | null) {
    start(async () => {
      const res = await setWorkspaceLogo(workspaceId, url)
      if (res.success) {
        showToast(url ? "Logo updated" : "Logo removed", { type: "success" })
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <ImageUpload
        folder="logos"
        maxFiles={1}
        // A 96px square — no reason to accept the component's 10MB default.
        maxFileSize={2_097_152}
        onUpload={(r) => save(r.secureUrl)}
      >
        <span className="group relative block">
          <WorkspaceAvatar id={workspaceId} name={name} logoUrl={logoUrl} size="lg" />
          <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70 text-[10px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
            Change
          </span>
        </span>
      </ImageUpload>

      {logoUrl ? (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={pending}
          className="text-[11px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
        >
          Remove
        </button>
      ) : null}
    </div>
  )
}
