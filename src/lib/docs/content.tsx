import "server-only"

import type { ComponentType } from "react"
import McpDoc from "@/content/docs/mcp.mdx"
import WebhooksDoc from "@/content/docs/webhooks.mdx"

/**
 * Compiled documentation bodies, by slug.
 *
 * SPLIT FROM `pages.ts` ON PURPOSE. This is the only module that imports MDX,
 * and `server-only` makes that a build error to reach from the browser rather
 * than a silent regression: the sidebar and the search dialog are client
 * components, and one careless import here would ship every page of prose,
 * every code sample and the whole component map into the bundle without
 * anything failing.
 *
 * Static imports rather than `import()` with a template literal. A dynamic
 * specifier makes the bundler synthesise a context module over the whole
 * directory — the same "bundle everything" cost, but implicit, so nobody sees
 * it in review. Two lines of boilerplate per page is a fair price for knowing
 * exactly what is in the graph, and `docs-content.test.ts` fails if a page in
 * the registry has no entry here.
 */
const DOC_BODIES: Record<string, ComponentType> = {
  webhooks: WebhooksDoc,
  mcp: McpDoc,
}

/**
 * The compiled body for a slug, or null.
 *
 * Returns an ELEMENT rather than the component. Handing back a component means
 * the caller assigns it to a capitalised local and renders `<Body />`, which
 * `react-hooks/static-components` flags — it cannot tell a lookup in a frozen
 * module-scope map from a component genuinely constructed during render, and
 * the latter would remount its whole subtree on every render. Returning the
 * element keeps the component references where they are provably static.
 */
export function docBody(slug: string): React.ReactElement | null {
  const Body = DOC_BODIES[slug]
  return Body ? <Body /> : null
}

/** Slugs with a compiled body, for the registry contract test. */
export const DOC_BODY_SLUGS = Object.keys(DOC_BODIES)
