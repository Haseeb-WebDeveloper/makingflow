import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { WorkspaceIntegrationsPanel } from "@/components/integrations/workspace-integrations"
import { getWorkspaceIntegrations } from "@/lib/data/integrations"

export const metadata: Metadata = { title: "Integrations · MakingFlow" }

export default async function IntegrationsPage() {
  const data = await getWorkspaceIntegrations()
  if (!data) redirect("/auth/login")

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect MakingFlow to the tools your team already uses. Connections apply across every form in your workspace."
      />
      <div className="mt-6 lg:mt-[1.667vw]">
        <WorkspaceIntegrationsPanel data={data} />
      </div>
    </PageContainer>
  )
}
