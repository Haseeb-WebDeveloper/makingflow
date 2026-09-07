/**
 * The sidebar's top-level sections.
 *
 * Array order IS display order. There is deliberately no numeric `order` field:
 * a number and an array position are two orderings that can disagree, and the
 * one that loses is whichever the reader is not looking at.
 *
 * Pure and client-safe — the sidebar is a client component and imports the
 * types from here via `nav.ts`.
 */

import type { IconName } from "@/components/ui/icon"

export type DocsGroupId = "getting-started" | "forms" | "integrations" | "ai" | "reference"

export type DocsGroup = {
  id: DocsGroupId
  title: string
  icon: IconName
}

/**
 * Seeded from doc/PRODUCT.md's feature list. Most are empty today, which is the
 * point of building the tree now rather than after there are twenty pages to
 * retrofit into it — a group with no pages simply does not render.
 */
export const DOCS_GROUPS: readonly DocsGroup[] = [
  { id: "getting-started", title: "Getting started", icon: "discovery" },
  { id: "forms", title: "Forms", icon: "document" },
  { id: "integrations", title: "Integrations", icon: "swap" },
  { id: "ai", title: "AI & MCP", icon: "chat" },
  { id: "reference", title: "Reference", icon: "category" },
]

export function groupById(id: DocsGroupId): DocsGroup | undefined {
  return DOCS_GROUPS.find((g) => g.id === id)
}
