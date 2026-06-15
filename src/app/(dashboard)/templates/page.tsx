import type { Metadata } from "next"
import { PageContainer, PageHeader, EmptyState } from "@/components/dashboard/page-shell"

export const metadata: Metadata = { title: "Templates · MakingFlow" }

export default function TemplatesPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        description="Start from a ready-made form and make it your own."
      />
      <EmptyState
        icon="category"
        title="Templates are coming"
        description="Job applications, surveys, intake briefs, and more, all ready to customize."
      />
    </PageContainer>
  )
}
