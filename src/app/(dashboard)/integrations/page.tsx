import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { WorkspaceIntegrationsPanel } from "@/components/integrations/workspace-integrations"
import { getWorkspaceIntegrations } from "@/lib/data/integrations"
import { sessionContext } from "@/lib/auth/context-web"
import { grantableWorkspaces, listKeys } from "@/lib/core/mcp-keys"
import { listConnectedApps } from "@/lib/mcp/oauth/grants"

export const metadata: Metadata = { title: "Integrations · MakingFlow" }
/**
 * The enable toggle on this page defers a Sheets/Notion backfill to after(),
 * which runs on the invoking page's budget — not the action's own.
 */
export const maxDuration = 60


export default async function IntegrationsPage() {
  const session = await sessionContext()
  if (!session.ok) redirect("/auth/login")

  const [data, keys, workspaces, apps] = await Promise.all([
    getWorkspaceIntegrations(session.ctx.workspaceId),
    listKeys(session.ctx),
    grantableWorkspaces(session.ctx),
    // Per USER, not per workspace: a person authorises an app once, for a set of
    // workspaces, so the list reads the same wherever they view it from.
    listConnectedApps(session.ctx.userId),
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
            apps,
            workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
            currentWorkspaceId: session.ctx.workspaceId,
            // Anyone may create a key — it can never exceed its creator. Owners can
            // additionally revoke keys other people made.
            isOwner: session.ctx.role === "owner",
            endpoint: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/mcp`,
          }}
        />
      </div>
    </PageContainer>
  )
}
