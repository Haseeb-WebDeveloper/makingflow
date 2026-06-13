import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { DomainsPanel } from "@/components/domains/domains-panel"
import { getWorkspaceDomains } from "@/lib/data/domains"

export const metadata: Metadata = { title: "Domains · MakingFlow" }

export default async function DomainsPage() {
  const data = await getWorkspaceDomains()
  if (!data) redirect("/auth/login")

  return (
    <PageContainer>
      <PageHeader
        title="Domains"
        description="Serve your forms from your own subdomain, like forms.yourbrand.com/feedback."
      />
      <div className="mt-6">
        <DomainsPanel data={data} />
      </div>
    </PageContainer>
  )
}
