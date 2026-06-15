import type { Metadata } from "next"
import Link from "next/link"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { Icon } from "@/components/ui/icon"

export const metadata: Metadata = { title: "Settings · MakingFlow" }

export default async function SettingsPage() {
  const workspace = await getDefaultWorkspace()

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your workspace, team, and billing."
      />

      <div className="mt-8 max-w-xl divide-y divide-border rounded-lg border border-border">
        <Row label="Workspace name" value={workspace?.name ?? "—"} />
        <Row label="Workspace URL" value={workspace ? `/${workspace.slug}` : "—"} />
        <Row
          label="Plan"
          value={
            <span className="capitalize">{workspace?.plan ?? "free"} plan</span>
          }
        />
      </div>

      <div className="mt-6 max-w-xl overflow-hidden rounded-lg border border-border">
        <Link
          href="/settings/team"
          className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-muted"
        >
          <span className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Team</span>
            <span className="text-xs text-muted-foreground">
              Invite teammates and manage roles
            </span>
          </span>
          <Icon name="add-user" className="size-4 text-muted-foreground" />
        </Link>
      </div>
    </PageContainer>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}
