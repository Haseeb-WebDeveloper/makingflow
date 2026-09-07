import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { PAGE_META } from "@/components/dashboard/page-meta"
import { DomainsSkeleton } from "@/components/dashboard/skeletons/domains-skeleton"

export default function DomainsLoading() {
  return (
    <PageContainer>
      <PageHeader {...PAGE_META.domains} />
      <DomainsSkeleton />
    </PageContainer>
  )
}
