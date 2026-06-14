import type { MetadataRoute } from "next"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://makingflow.com"

/**
 * Sitemap for the public marketing surface only. User forms are intentionally
 * NOT enumerated — they're shared by link and aren't meant to be discoverable
 * through search.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ]
}
