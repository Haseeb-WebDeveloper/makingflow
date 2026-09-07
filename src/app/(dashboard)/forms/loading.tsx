import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { PAGE_META } from "@/components/dashboard/page-meta"
import { HomeSkeleton } from "@/components/dashboard/skeletons/home-skeleton"

/**
 * Home, loading.
 *
 * The heading is the REAL heading, not a bar the width of one. Its text is
 * known before any query runs, so a reader arriving here can already read what
 * they are waiting for — and nothing under it shifts when the numbers land,
 * because the skeleton below occupies exactly the boxes they will fill.
 *
 * Both this and the page read their title from PAGE_META, so the two cannot end
 * up saying different things.
 */
export default function FormsLoading() {
  return (
    <PageContainer>
      <PageHeader {...PAGE_META.home} />
      <HomeSkeleton />
    </PageContainer>
  )
}
