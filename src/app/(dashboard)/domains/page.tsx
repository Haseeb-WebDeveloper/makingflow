import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { PAGE_META } from "@/components/dashboard/page-meta"
import { DomainsPanel } from "@/components/domains/domains-panel"
import { getWorkspaceDomains } from "@/lib/data/domains"
import { getDefaultWorkspace } from "@/lib/auth/session"

export const metadata: Metadata = { title: "Domains · MakingFlow" }

export default async function DomainsPage() {
  const workspace = await getDefaultWorkspace()
  if (!workspace) redirect("/auth/login")
  const data = await getWorkspaceDomains(workspace.id)
  if (!data) redirect("/auth/login")

  return (
    <PageContainer>
      <PageHeader {...PAGE_META.domains} />
      <div className="mt-6">
        <DomainsPanel data={data} />
      </div>
    </PageContainer>
  )
}
