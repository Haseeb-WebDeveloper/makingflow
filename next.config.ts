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
};

export default nextConfig;
