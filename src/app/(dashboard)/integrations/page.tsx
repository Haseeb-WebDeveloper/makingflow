import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { WorkspaceIntegrationsPanel } from "@/components/integrations/workspace-integrations"
import { getWorkspaceIntegrations } from "@/lib/data/integrations"
import { sessionContext } from "@/lib/auth/context-web"
import { grantableWorkspaces, listKeys } from "@/lib/core/mcp-keys"

export const metadata: Metadata = { title: "Integrations · MakingFlow" }
/**
 * The enable toggle on this page defers a Sheets/Notion backfill to after(),
 * which runs on the invoking page's budget — not the action's own.
 */
export const maxDuration = 60


export default async function IntegrationsPage() {
  const session = await sessionContext()
  if (!session.ok) redirect("/auth/login")

  const [data, keys, workspaces] = await Promise.all([
    getWorkspaceIntegrations(),
    listKeys(session.ctx),
    grantableWorkspaces(session.ctx),
  ])
  if (!data) redirect("/auth/login")

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect MakingFlow to the tools your team already uses. Connections apply across every form in your workspace."
      />
      <div className="mt-6">
        <WorkspaceIntegrationsPanel
          data={data}
          mcp={{
            keys,
            workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
            currentWorkspaceId: session.ctx.workspaceId,
            // Minting a key that can read every response is the same weight as
            // inviting a teammate, which is already owner-only.
            canCreate: session.ctx.role === "owner",
            endpoint: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/mcp`,
          }}
        />
      </div>
    </PageContainer>
  )
}
