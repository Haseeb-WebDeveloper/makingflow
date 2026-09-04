import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Imports a file under src/lib/core/** may not reach for.
 *
 * The core layer is transport-agnostic on purpose: one implementation serves
 * both the browser (cookie session) and the MCP server (API key). Anything that
 * resolves the caller from ambient request state would bind it to the web and,
 * worse, would make a core function silently read the WRONG tenant when called
 * from a bearer-token request that has no cookie at all.
 *
 * `next/cache` and `next/server` are deliberately absent — core owns cache
 * invalidation (updateTag/revalidatePath) and deferred work (after()), because
 * if the wrapper owned them every future MCP tool author would have to remember
 * to invalidate, and the failure mode is the public form runtime serving a stale
 * definition.
 */
const CORE_FORBIDDEN_IMPORTS = [
  {
    name: "next/headers",
    message:
      "core is transport-agnostic: cookies()/headers() bind it to the web. Take what you need from ctx.",
  },
  {
    name: "next/navigation",
    message:
      "core never redirects — return { success: false, error } and let the action wrapper decide.",
  },
  {
    name: "@/lib/auth/session",
    message: "core must not resolve the caller. It receives an AuthContext as its first argument.",
  },
  {
    name: "@/lib/auth/context-web",
    message: "that is the cookie producer — the wrapper builds the ctx, core consumes it.",
  },
  { name: "@/lib/auth/fast-session", message: "reads the session cookie." },
  {
    name: "@/lib/auth/active-workspace",
    message: "the mf_ws cookie is a web-only preference, never an authorization input.",
  },
  { name: "@/lib/supabase/server", message: "createClient() reads cookies()." },
  {
    name: "@/lib/rate-limit",
    message:
      "rateLimit() keys on the client IP via headers(); rate-limit per API key in the MCP transport instead.",
  },
  {
    name: "@/lib/auth/permissions",
    importNames: ["requireOwner", "requireMember", "requireWorkspaceOwner"],
    message:
      "those gates read the session. Use authorize(ctx, { action }) from @/lib/auth/context — can() and OWNER_ONLY are still fine.",
  },
];

/**
 * Minting an AuthContext is a security decision, not a convenience. Only a
 * context PRODUCER — something that has actually verified a credential — may
 * call the sealer.
 *
 * NOTE: flat config does not MERGE two `no-restricted-imports` entries that
 * match the same file — the later block replaces the earlier one wholesale. So
 * this is a shared constant spliced into every block that sets the rule, rather
 * than a standalone block that would silently disable the core import bans.
 */
const SEAL_RESTRICTION = {
  name: "@/lib/auth/context",
  importNames: ["unsafeSealContext"],
  message:
    "Only a context producer may mint an AuthContext. Add a producer module; never hand-roll one from request input.",
};

/** Producers, which are allowed to call the sealer. */
const CONTEXT_PRODUCERS = [
  "src/lib/auth/context.ts",
  "src/lib/auth/context-web.ts",
  "src/lib/mcp/auth.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Everything except the producers: the sealer is off limits.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: CONTEXT_PRODUCERS,
    rules: {
      "no-restricted-imports": ["error", { paths: [SEAL_RESTRICTION] }],
    },
  },

  /**
   * The core layer boundary. This is what turns "core is transport-agnostic"
   * from a convention into a guarantee.
   *
   * Must come AFTER the block above and restate the seal restriction, because
   * the later match wins outright for files under src/lib/core/**.
   */
  {
    files: ["src/lib/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...CORE_FORBIDDEN_IMPORTS, SEAL_RESTRICTION],
          patterns: [
            {
              group: ["@/lib/actions", "@/lib/actions/*"],
              message:
                "core must never call a Server Action — the dependency runs wrapper → core, one way.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // src/lib/actions/*.ts are file-level "use server", so every export
          // there is a network-reachable RPC endpoint whose arguments are
          // deserialized from a browser POST. A "use server" core file would
          // therefore expose `ctx` as a CLIENT-SUPPLIED argument: any session
          // could post { workspaceId: "<someone else's>", role: "owner" } and
          // be obeyed. This is an unauthenticated cross-tenant write. Never.
          selector: 'ExpressionStatement > Literal[value="use server"]',
          message:
            'A "use server" core file exposes ctx as a client-supplied argument — an unauthenticated cross-tenant write. Keep "use server" in src/lib/actions/ wrappers only.',
        },
        {
          selector: 'ExpressionStatement > Literal[value="use cache"]',
          message:
            'core mutates and invalidates; a "use cache" scope can do neither. Cached reads belong in src/lib/data/.',
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
