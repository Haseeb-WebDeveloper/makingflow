import type { Metadata } from "next"
import { PageContainer, PageHeader, EmptyState } from "@/components/dashboard/page-shell"

export const metadata: Metadata = { title: "Analytics · MakingFlow" }

export default function AnalyticsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description="Submissions, conversion, drop-off, and completion time."
      />
      <EmptyState
        icon="chart"
        title="Nothing to chart yet"
        description="Publish a form and start collecting responses to see analytics."
      />
    </PageContainer>
  )
}
