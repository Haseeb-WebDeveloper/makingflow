import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables the "use cache" directive + Cache Components (PPR). Everything is
  // dynamic by default; reads opt into caching explicitly.
  cacheComponents: true,

  // React Compiler — auto-memoization.
  reactCompiler: true,

  // Forward browser errors to the dev terminal (16.2+) — helps debugging.
  logging: {
    browserToTerminal: "error",
  },

  allowedDevOrigins: ['192.168.100.5'],

  // The docs pages read their .mdx sources with sync fs at prerender (search
  // index, table of contents). That happens at build, so the files only need to
  // exist then — but if anything ever flips those routes dynamic, the read
  // would run in a lambda that never packaged them. Cheap insurance.
  outputFileTracingIncludes: {
    "/docs/**": ["./src/content/docs/**/*"],
  },
};

/**
 * MDX, for the documentation under /docs.
 *
 * NO `pageExtensions`. It exists to make .mdx files routable from within
 * `app/`, which we deliberately do not do — every doc is imported by
 * `src/lib/docs/manifest.ts` and served through one catch-all route. Adding it
 * would mean restating `ts`/`tsx` in a list that also governs how Next resolves
 * `src/proxy.ts`, and a typo there unhooks the auth proxy silently.
 *
 * NO remark/rehype plugins either, which is not laziness — Turbopack is the
 * default builder in Next 16 and passes plugin options across a JS/Rust
 * boundary, so options must be JSON-serializable and plugins must be named as
 * strings. Anything taking a function (the usual syntax-highlighting setups)
 * cannot work. We do the two jobs a plugin would do — heading ids and
 * highlighting — in the component map instead, where they are ordinary code.
 *
 * NO `providerImportSource` most of all: it routes the component map through
 * React context, which forces a client provider and bans async server
 * components as map entries. `CodeBlock` is one.
 */
const withMDX = createMDX({});

export default withMDX(nextConfig);
