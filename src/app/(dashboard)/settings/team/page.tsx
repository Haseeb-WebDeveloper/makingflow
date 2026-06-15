import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import { getTeam } from "@/lib/data/team"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { TeamManager } from "@/components/dashboard/team-manager"

export const metadata: Metadata = { title: "Team · MakingFlow" }

export default async function TeamPage() {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()

  const { members, invitations } = await getTeam(workspace.id)
  const isOwner = workspace.role === "owner"

  return (
    <PageContainer>
      <PageHeader
        title="Team"
        description={
          isOwner
            ? `Invite people to ${workspace.name} and manage their roles.`
            : `People with access to ${workspace.name}.`
        }
      />
      <TeamManager
        members={members}
        invitations={invitations}
        currentUserId={user.id}
        isOwner={isOwner}
      />
    </PageContainer>
  )
}
