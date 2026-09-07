import type { MetadataRoute } from "next"
import { DOCS_PAGES, docHref } from "@/lib/docs/pages"
import { siteUrl } from "@/lib/docs/site-url"

/**
 * Sitemap for the public marketing surface only. User forms are intentionally
 * NOT enumerated — they're shared by link and aren't meant to be discoverable
 * through search.
 *
 * The documentation IS meant to be found: it is written for developers who do
 * not have an account and are most likely to arrive from a search for "webhook
 * signature" rather than from our homepage. Both pages existed for months
 * without appearing here, reachable only by deep link.
 *
 * Derived from the registry, so a new page is listed by the act of adding it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()

  return [
    {
      url: `${base}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/docs`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...DOCS_PAGES.map((page) => ({
      url: `${base}${docHref(page)}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ]
}
