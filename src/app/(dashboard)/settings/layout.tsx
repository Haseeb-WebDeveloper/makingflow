import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { SettingsNav } from "@/components/dashboard/settings-nav"

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your account, workspaces, and team."
      />
      <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:gap-10">
        <aside className="shrink-0 sm:w-48">
          <SettingsNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageContainer>
  )
}
