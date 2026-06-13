import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { getFormShell } from "@/lib/data/forms"
import { SharePanel } from "@/components/forms/share-panel"

export const metadata: Metadata = { title: "Share · MakingFlow" }

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const shell = await getFormShell(id)
  if (!shell) notFound()

  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const url = `${proto}://${host}/f/${shell.publicId}`

  return <SharePanel url={url} published={shell.status === "published"} />
}
