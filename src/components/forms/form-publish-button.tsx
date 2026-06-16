"use client"

import { useState } from "react"
import { publishForm, unpublishForm } from "@/lib/actions/forms"
import { setFormDomain } from "@/lib/actions/domains"
import { buildShareUrl } from "@/lib/forms/share"
import type { FormSettingsData } from "@/lib/data/forms"
import type { WorkspaceFolder } from "@/lib/data/folders"
import type { SetDomainResult } from "@/components/forms/domain-picker"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { PublishDialog } from "@/components/builder/publish-dialog"
import { showToast } from "@/components/ui/toast"

/**
 * Header action on the form-detail pages: a single Publish/Share button that
 * opens the same PublishDialog used in the builder. Replaces the old Share tab —
 * publishing, the live link, custom domain, and submission settings all live in
 * the dialog. The form is already persisted here (this isn't the editor), so
 * publishing just calls the action directly with no save-flush dance.
 */
export function FormPublishButton({
  formId,
  formTitle,
  initialStatus,
  publicId,
  origin,
  domains,
  initialDomainId,
  initialSlug,
  initialDomainHost,
  folders,
  settings,
}: {
  formId: string
  formTitle: string
  initialStatus: string
  publicId: string
  origin: string
  domains: { id: string; domain: string }[]
  initialDomainId: string | null
  initialSlug: string | null
  initialDomainHost: string | null
  folders: WorkspaceFolder[]
  settings: FormSettingsData | null
}) {
  const [open, setOpen] = useState(false)
  const [published, setPublished] = useState(initialStatus === "published")
  const [publishing, setPublishing] = useState(false)
  const [domainId, setDomainId] = useState<string | null>(initialDomainId)
  const [slug, setSlug] = useState<string | null>(initialSlug)
  const [domainHost, setDomainHost] = useState<string | null>(initialDomainHost)

  // A custom domain (if attached) wins over the default link.
  const shareUrl = buildShareUrl({ origin, publicId, domain: domainHost, slug })

  async function publish() {
    if (publishing) return
    setPublishing(true)
    const res = await publishForm(formId)
    setPublishing(false)
    if (res.success) {
      setPublished(true)
      showToast("Your form is live 🎉", { type: "success" })
    } else {
      showToast(res.error, { type: "error" })
    }
  }

  async function unpublish() {
    const res = await unpublishForm(formId)
    if (res.success) setPublished(false)
    else showToast(res.error ?? "Could not unpublish", { type: "error" })
  }

  async function applyDomain(
    nextId: string | null,
    nextSlug: string | null,
  ): Promise<SetDomainResult> {
    const res = await setFormDomain(formId, { customDomainId: nextId, slug: nextSlug })
    if (res.success) {
      setDomainId(nextId)
      setSlug(res.slug ?? null)
      setDomainHost(res.domain ?? null)
    }
    return res
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-9 px-3.5">
        <Icon name="send" className="size-4" />
        {published ? "Share" : "Publish"}
      </Button>
      <PublishDialog
        open={open}
        onOpenChange={setOpen}
        published={published}
        publishing={publishing}
        shareUrl={shareUrl}
        formId={formId}
        formTitle={formTitle}
        domains={domains}
        domainId={domainId}
        slug={slug}
        domainHost={domainHost}
        onSetDomain={applyDomain}
        folders={folders}
        settings={settings}
        formStatus={published ? "published" : initialStatus}
        onPublish={publish}
        onUnpublish={unpublish}
      />
    </>
  )
}
