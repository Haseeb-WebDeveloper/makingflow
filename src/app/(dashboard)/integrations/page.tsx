import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { WorkspaceIntegrationsPanel } from "@/components/integrations/workspace-integrations"
import { getWorkspaceIntegrations } from "@/lib/data/integrations"

export const metadata: Metadata = { title: "Integrations · MakingFlow" }
/**
 * The enable toggle on this page defers a Sheets/Notion backfill to after(),
 * which runs on the invoking page's budget — not the action's own.
 */
export const maxDuration = 60


export default async function IntegrationsPage() {
  const data = await getWorkspaceIntegrations()
  if (!data) redirect("/auth/login")

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect MakingFlow to the tools your team already uses. Connections apply across every form in your workspace."
      />
      <div className="mt-6">
        <WorkspaceIntegrationsPanel data={data} />
      </div>
    </PageContainer>
  )
}
