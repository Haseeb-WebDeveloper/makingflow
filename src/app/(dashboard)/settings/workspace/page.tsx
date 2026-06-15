import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import { getTeam } from "@/lib/data/team"
import { TeamManager } from "@/components/dashboard/team-manager"

export const metadata: Metadata = { title: "Workspace · MakingFlow" }

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
}

export default async function WorkspaceDetailPage() {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()

  const { members, invitations } = await getTeam(workspace.id)
  const isOwner = workspace.role === "owner"

  return (
    <div>
      <div className="rounded-lg border border-border p-5">
        <div className="flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-foreground text-lg font-semibold text-background">
            {workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">
              {workspace.name}
            </h2>
            <p className="truncate text-xs text-muted-foreground">/{workspace.slug}</p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1 text-xs text-muted-foreground">
            <span>{PLAN_LABEL[workspace.plan] ?? workspace.plan} plan</span>
            <span className="capitalize">You are {isOwner ? "an owner" : "a member"}</span>
          </div>
        </div>
      </div>

      <TeamManager
        members={members}
        invitations={invitations}
        currentUserId={user.id}
        isOwner={isOwner}
      />
    </div>
  )
}
