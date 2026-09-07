/**
 * Every dashboard page's heading, in one place.
 *
 * A page and its `loading.tsx` both render the heading — the page because it is
 * the heading, the loading state because a title and description are known
 * before any query runs and there is no reason to show a grey bar where a word
 * we already have belongs.
 *
 * That means two files rendering the same string, which is the setup for the
 * two drifting apart: someone rewrites a description on the page, the loading
 * state keeps the old one, and for a moment the reader sees text that then
 * changes under them. Reading both from here makes that impossible.
 *
 * Pure data, no imports — safe from a server page, a client component or a test.
 */

export type PageMeta = {
  title: string
  description?: string
}

export const PAGE_META = {
  home: {
    title: "Home",
    description: "An overview of your forms and how they're performing.",
  },
  domains: {
    title: "Domains",
    description:
      "Serve your forms from your own subdomain, like forms.yourbrand.com/feedback.",
  },
  integrations: {
    title: "Integrations",
    description:
      "Connect MakingFlow to the tools your team already uses. Connections apply across every form in your workspace.",
  },
  templates: {
    title: "Templates",
  },
  migrations: {
    title: "Migrations",
  },
  account: {
    title: "Account",
  },
  workspace: {
    title: "Workspace",
  },
  workspaces: {
    title: "Workspaces",
  },
} as const satisfies Record<string, PageMeta>

export type PageMetaKey = keyof typeof PAGE_META
