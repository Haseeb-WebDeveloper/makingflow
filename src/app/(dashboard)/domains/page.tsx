import type { Metadata } from "next"
import { PageContainer, PageHeader, EmptyState } from "@/components/dashboard/page-shell"

export const metadata: Metadata = { title: "Domains · MakingFlow" }

export default function DomainsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Domains"
        description="Serve your forms from your own custom domain."
      />
      <EmptyState
        icon="discovery"
        title="Custom domains are coming soon"
        description="Soon you'll be able to publish forms at forms.yourbrand.com instead of the default link. We'll let you know when it's ready."
      />
    </PageContainer>
  )
}
