import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { PAGE_META } from "@/components/dashboard/page-meta"
import { IntegrationsSkeleton } from "@/components/dashboard/skeletons/integrations-skeleton"

/**
 * Integrations, loading.
 *
 * Nearly the whole page is knowable in advance, so nearly the whole page is
 * drawn. See the skeleton for what is left grey and why.
 */
export default function IntegrationsLoading() {
  return (
    <PageContainer>
      <PageHeader {...PAGE_META.integrations} />
      <IntegrationsSkeleton />
    </PageContainer>
  )
}
