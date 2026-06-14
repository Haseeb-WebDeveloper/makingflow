import type { MetadataRoute } from "next"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://makingflow.com"

/**
 * Crawl policy. The marketing site and public form runtimes (/f, /sites) stay
 * crawlable; the authed app, auth flows, and API are kept out of search. Whether
 * an individual form gets indexed is controlled per-page (a form is noindex by
 * default — see the form runtime metadata), not here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/forms", // the builder app (form list, builder, detail)
          "/settings",
          "/integrations",
          "/domains",
          "/templates",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
