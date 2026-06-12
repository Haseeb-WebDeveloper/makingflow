import type { Metadata } from "next"
import { getRequiredUser } from "@/lib/auth/session"
import { PageContainer, PageHeader, EmptyState } from "@/components/dashboard/page-shell"

export const metadata: Metadata = { title: "Forms · MakingFlow" }

export default async function FormsPage() {
  const user = await getRequiredUser()
  const firstName = (user.name || user.email).split(/[\s@]/)[0]

  return (
    <PageContainer>
      <PageHeader
        title="Forms"
        description={`Welcome back, ${firstName}. Build and manage your forms here.`}
        action={
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            New form
          </button>
        }
      />
      <EmptyState
        icon="document"
        title="No forms yet"
        description="Describe a form in plain language and MakingFlow will build it — coming next."
      />
    </PageContainer>
  )
}
