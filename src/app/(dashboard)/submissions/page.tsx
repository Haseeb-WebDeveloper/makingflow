import type { Metadata } from "next"
import { PageContainer, PageHeader, EmptyState } from "@/components/dashboard/page-shell"

export const metadata: Metadata = { title: "Submissions · MakingFlow" }

export default function SubmissionsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Submissions"
        description="Every response across your forms, with AI summaries."
      />
      <EmptyState
        icon="folder"
        title="No submissions yet"
        description="Once people start filling out your forms, their responses land here."
      />
    </PageContainer>
  )
}
