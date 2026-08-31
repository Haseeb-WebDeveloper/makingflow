import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { getFormSettings } from "@/lib/data/forms"
import { FormSettings } from "@/components/forms/form-settings"
import { countPendingMedia } from "@/lib/actions/rehost-media"
import { RehostMediaCard } from "@/components/forms/rehost-media-card"

export const metadata: Metadata = { title: "Form settings · MakingFlow" }

// The media sweep runs from this page, and Server Actions inherit the invoking
// page's budget. A pass copies up to 40 files, each fetched by Cloudinary.
export const maxDuration = 60

export default async function FormSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()
  const settings = await getFormSettings(id, workspace.id)
  if (!settings) notFound()

  // Only shown when there is something to move, so a form that never came from
  // another tool never sees it.
  const pending = await countPendingMedia(id)
  const showRehost = pending.success && pending.files + pending.assets > 0

  return (
    <div className="space-y-6">
      {showRehost ? (
        <RehostMediaCard formId={id} files={pending.files} assets={pending.assets} />
      ) : null}
      <FormSettings formId={id} initial={settings} />
    </div>
  )
}
