import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { getFormShell } from "@/lib/data/forms"
import { getActiveDomains } from "@/lib/data/domains"
import { buildShareUrl } from "@/lib/forms/share"
import { SharePanel } from "@/components/forms/share-panel"

export const metadata: Metadata = { title: "Share · MakingFlow" }

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [shell, domains] = await Promise.all([getFormShell(id), getActiveDomains()])
  if (!shell) notFound()

  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  // A custom domain (if attached) wins over the default link.
  const url = buildShareUrl({
    origin: `${proto}://${host}`,
    publicId: shell.publicId,
    domain: shell.domain,
    slug: shell.slug,
  })

  return (
    <SharePanel
      url={url}
      published={shell.status === "published"}
      formId={shell.id}
      formTitle={shell.title}
      domains={domains}
      domainId={shell.customDomainId}
      slug={shell.slug}
      domainHost={shell.domain}
    />
  )
}
