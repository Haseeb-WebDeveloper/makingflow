import type { Metadata } from "next"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"

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
