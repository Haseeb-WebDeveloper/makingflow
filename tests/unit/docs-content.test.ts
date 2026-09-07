/**
 * The documentation registry, the files, and the prose, held to each other.
 *
 * Three kinds of drift are possible once content lives in .mdx and metadata
 * lives in a TypeScript list, and each fails differently and late:
 *
 *   - a file with no registry entry is simply invisible — no nav, no route, no
 *     search result, and nothing errors;
 *   - a registry entry with no file breaks the build, but only at prerender,
 *     with a module-resolution error that does not mention the registry;
 *   - a `<Val>` key that does not exist throws at prerender, likewise.
 *
 * All three become a sub-second unit failure here. The registry cannot be
 * imported alongside the compiled bodies (`content.tsx` imports .mdx, which
 * vitest has no toolchain for), so that one file is checked as source text.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildNav, findAdjacent, isDocsNavActive } from "@/lib/docs/nav"
import { DOCS_PAGES, PINNED_SLUGS, docBySlug } from "@/lib/docs/pages"
import { DOC_VALUES, isDocValueKey } from "@/lib/docs/values"
import { extractHeadings, stripToPlainText } from "@/lib/docs/source"
import { docMarkdown } from "@/lib/docs/markdown"
import { MCP_CLIENTS } from "@/lib/mcp/client-catalog"
import { TIMEOUT_MS, TIMESTAMP_TOLERANCE_SECONDS } from "@/lib/integrations/webhook-policy"
import { SIGNATURE_HEADER } from "@/lib/integrations/webhook-signature"

const CONTENT_DIR = join(process.cwd(), "src", "content", "docs")

/** `_samples` is code, not content — the underscore keeps Next out of it too. */
const mdxFiles = readdirSync(CONTENT_DIR)
  .filter((name) => name.endsWith(".mdx"))
  .map((name) => name.replace(/\.mdx$/, ""))

const contentSource = readFileSync(join(process.cwd(), "src", "lib", "docs", "content.tsx"), "utf8")

describe("the registry and the content directory agree", () => {
  test("every .mdx file has a registry entry", () => {
    for (const slug of mdxFiles) {
      expect(docBySlug(slug), `${slug}.mdx has no entry in DOCS_PAGES`).toBeDefined()
    }
  })

  test("every registry entry has a file", () => {
    for (const page of DOCS_PAGES) {
      expect(mdxFiles, `DOCS_PAGES lists "${page.slug}" but there is no .mdx`).toContain(page.slug)
    }
  })

  test("every registry entry has a compiled body", () => {
    // Source text, not an import: content.tsx imports .mdx, which vitest cannot
    // compile. Do not "fix" this into a real import — it will stop running.
    for (const page of DOCS_PAGES) {
      expect(contentSource, `content.tsx has no body for "${page.slug}"`).toContain(
        `${page.slug}:`,
      )
    }
  })

  test("slugs are unique", () => {
    expect(new Set(DOCS_PAGES.map((p) => p.slug)).size).toBe(DOCS_PAGES.length)
  })

  test("generateStaticParams can never be empty", () => {
    // Under cacheComponents an empty list is a build error whose message talks
    // about static params rather than about the registry.
    expect(DOCS_PAGES.length).toBeGreaterThan(0)
  })
})

describe("the externally published URLs", () => {
  test("still exist", () => {
    // /docs/mcp is named by `resource_documentation` in the RFC 9728 metadata
    // and by `service_documentation` in the OAuth discovery document;
    // /docs/webhooks is linked from the in-app webhooks card. Renaming either
    // breaks a URL we have told other people to rely on.
    for (const slug of PINNED_SLUGS) {
      expect(docBySlug(slug), `/docs/${slug} is published externally`).toBeDefined()
    }
  })
})

describe("the prose", () => {
  const sources = Object.fromEntries(
    mdxFiles.map((slug) => [slug, readFileSync(join(CONTENT_DIR, `${slug}.mdx`), "utf8")]),
  )

  test("only references values that exist", () => {
    for (const [slug, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/<Val\s+name="([^"]+)"/g)) {
        expect(isDocValueKey(match[1]), `${slug}.mdx uses unknown <Val name="${match[1]}">`).toBe(
          true,
        )
      }
    }
  })

  test("does not open with an h1 — the page shell renders the title", () => {
    for (const [slug, source] of Object.entries(sources)) {
      expect(source, `${slug}.mdx should not declare its own h1`).not.toMatch(/^#\s+/m)
    }
  })

  test("carries no live secret", () => {
    for (const [slug, source] of Object.entries(sources)) {
      expect(source, `${slug}.mdx`).not.toMatch(/mf_sk_live_[A-Za-z0-9]/)
      expect(source, `${slug}.mdx`).not.toMatch(/whsec_[A-Za-z0-9]{8}/)
    }
  })

  describe("webhooks.mdx", () => {
    const source = sources.webhooks

    test("keeps the sentences a reader's data model depends on", () => {
      const text = stripToPlainText(source)
      expect(text).toContain("Use the raw request body")
      expect(text).toContain("Order is not guaranteed")
      expect(text).toContain("at least once")
      expect(text).toContain("Treat every value as untrusted input")
      expect(text).toContain("Do not build against it")
    })

    test("renders the derived tables rather than describing them", () => {
      // The guard against someone "simplifying" a component back into typed
      // prose or a fenced block — which for the receivers would publish the
      // literal characters `${TIMESTAMP_TOLERANCE_SECONDS}` to the internet.
      expect(source).toContain("<WebhookRetryTable")
      expect(source).toContain("<WebhookHeadersTable")
      expect(source).toContain('<WebhookReceiver runtime="node"')
      expect(source).toContain('<WebhookReceiver runtime="python"')
    })

    test("quotes no policy number by hand", () => {
      // Every one of these has a <Val> key. A bare "10 seconds" in the prose is
      // a number that will not follow the policy when it changes — the exact
      // failure this whole arrangement exists to prevent.
      const prose = stripToPlainText(source).replace(/<Val[^>]*\/>/g, "")
      expect(prose).not.toMatch(/\b10 seconds\b/)
      expect(prose).not.toMatch(/\b5 minutes\b/)
      expect(prose).not.toMatch(/\b30 days\b/)
    })

    test("preserves the anchors already published", () => {
      const ids = extractHeadings(source).map((h) => h.id)
      expect(ids).toContain("payload")
      expect(ids).toContain("verify")
      expect(ids).toContain("retries")
    })
  })

  describe("mcp.mdx", () => {
    const source = sources.mcp

    test("renders the catalogs rather than listing clients by hand", () => {
      expect(source).toContain('<McpClientGuides method="oauth"')
      expect(source).toContain('<McpClientGuides method="api-key"')
      expect(source).toContain("<McpPermissionsTable")
    })

    test("has anchors on every section — it had none at all before", () => {
      const headings = extractHeadings(source)
      expect(headings.length).toBeGreaterThan(0)
      for (const heading of headings) {
        expect(heading.id, `"${heading.text}" has no anchor`).toBeTruthy()
      }
    })
  })
})

describe("navigation", () => {
  test("every group shown has at least one page", () => {
    for (const group of buildNav()) {
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  test("every nav href points into /docs", () => {
    for (const group of buildNav()) {
      for (const item of group.items) {
        expect(item.href).toMatch(/^\/docs\//)
      }
    }
  })

  test("active state is exact, so one page cannot light up another", () => {
    expect(isDocsNavActive("/docs/webhooks", "/docs/webhooks")).toBe(true)
    // The reason this is not `startsWith`: a future page would prefix-match.
    expect(isDocsNavActive("/docs/webhooks-advanced", "/docs/webhooks")).toBe(false)
  })

  test("the ends of the list have no neighbour beyond them", () => {
    const first = DOCS_PAGES[0]
    const last = DOCS_PAGES[DOCS_PAGES.length - 1]
    expect(findAdjacent(first.slug).previous).toBeNull()
    expect(findAdjacent(last.slug).next).toBeNull()
  })
})

describe("values", () => {
  test("the mcp endpoint is absolute and has exactly one slash before /api", () => {
    // The old page fell back to a preview host, never stripped a trailing
    // slash, and used `??` so an empty env produced a bare "/api/mcp".
    const endpoint = DOC_VALUES["mcp.endpoint"]
    expect(endpoint).toMatch(/^https?:\/\//)
    expect(endpoint).toMatch(/[^/]\/api\/mcp$/)
  })
})

describe("the Markdown rendition", () => {
  // Backs "Copy page", /docs/<slug>/md and the open-in-ChatGPT/Claude links.
  // An assistant reading it must get the same facts a human reads on the page.
  const webhooks = docMarkdown("webhooks") ?? ""
  const mcp = docMarkdown("mcp") ?? ""

  test("resolves live values instead of emitting component tags", () => {
    expect(webhooks).not.toContain("<Val")
    expect(webhooks).not.toContain("<WebhookRetryTable")
    expect(webhooks).not.toContain("<WebhookReceiver")
    expect(mcp).not.toContain("<McpPermissionsTable")
    expect(mcp).not.toContain("<McpClientGuides")
  })

  test("carries the real policy numbers", () => {
    expect(webhooks).toContain(`within ${TIMEOUT_MS / 1000} seconds`)
    expect(webhooks).toContain("30 seconds later")
    expect(webhooks).toContain(SIGNATURE_HEADER)
  })

  test("keeps the receivers intact, first line included", () => {
    // The MDX-stripping pass used to run twice, and the second pass deleted
    // `import crypto from "node:crypto"` from inside the expanded sample —
    // publishing signature-verification code that will not run.
    expect(webhooks).toContain('import crypto from "node:crypto"')
    expect(webhooks).toContain("import hmac, hashlib, time")
    expect(webhooks).toContain(`> ${TIMESTAMP_TOLERANCE_SECONDS}`)
  })

  test("drops the MDX-only anchor syntax from headings", () => {
    // `## What we send [#payload]` is meaningful in MDX and noise in Markdown.
    expect(webhooks).not.toMatch(/^#{2,}.*\[#[a-z-]+\]/m)
    expect(webhooks).toContain("## What we send")
  })

  test("opens with a title and a summary, which the page shell owns", () => {
    expect(webhooks.startsWith("# Webhooks")).toBe(true)
    expect(mcp.startsWith("# MCP server")).toBe(true)
  })

  test("lists every MCP client from the catalog", () => {
    for (const client of MCP_CLIENTS) {
      expect(mcp, `${client.name} missing from the Markdown`).toContain(`### ${client.name}`)
    }
  })

  test("is null for a slug that does not exist", () => {
    expect(docMarkdown("nope")).toBeNull()
  })
})
