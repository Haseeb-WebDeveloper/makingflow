import type { Metadata } from "next"
import { getDefaultWorkspace, getMyWorkspaces } from "@/lib/auth/session"
import { WorkspaceList } from "@/components/dashboard/workspace-list"

export const metadata: Metadata = { title: "Workspaces · MakingFlow" }

export default async function WorkspacesSettingsPage() {
  const [workspaces, active] = await Promise.all([
    getMyWorkspaces(),
    getDefaultWorkspace(),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Your workspaces</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Switch between workspaces or manage the active one&apos;s team.
        </p>
      </div>
      <WorkspaceList
        workspaces={workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          slug: w.slug,
          plan: w.plan,
          role: w.role,
        }))}
        activeId={active?.id ?? null}
      />
    </div>
  )
}
