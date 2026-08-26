/**
 * Regression: picking the Notion page that form databases are created under.
 *
 * The original code took the first page /search returned. In a real workspace
 * that was a Person profile — a row in Notion's built-in People database — and
 * Notion rejects it:
 *
 *   400 validation_error
 *   "Person profile with ID … cannot have content"
 *
 * That threw inside the best-effort submission sync, was swallowed by its catch,
 * and left the form's integration row unwritten. The UI then reported "Pending
 * first response" forever, even with responses in hand.
 *
 * Shape below mirrors the live /search payload that reproduced it: 22 of the
 * first 26 results were database rows.
 */
import { describe, expect, test } from "vitest"
import { selectParentCandidates, type SearchPage } from "@/lib/integrations/notion"

const titled = (name: string) => ({
  title: { type: "title", title: [{ plain_text: name }] },
})

const personProfile: SearchPage = {
  id: "person-1",
  object: "page",
  parent: { type: "database_id" },
  properties: titled("Haseeb Ahmed Raza Khan"),
}
const databaseRow: SearchPage = {
  id: "row-1",
  object: "page",
  parent: { type: "database_id" },
  properties: titled("Some task"),
}
const topLevelPage: SearchPage = {
  id: "top-1",
  object: "page",
  parent: { type: "workspace" },
  properties: titled("Getting Started"),
}
const nestedPage: SearchPage = {
  id: "nested-1",
  object: "page",
  parent: { type: "page_id" },
  properties: titled("Example sub-page"),
}

describe("selectParentCandidates", () => {
  test("never offers a database row, whatever the search order", () => {
    // Person profile first — exactly what broke it.
    const picked = selectParentCandidates([personProfile, databaseRow, topLevelPage])
    expect(picked.map((p) => p.id)).toEqual(["top-1"])
  })

  test("prefers a top-level page over a nested one", () => {
    const picked = selectParentCandidates([nestedPage, topLevelPage])
    expect(picked[0].id).toBe("top-1")
  })

  test("skips archived and trashed pages", () => {
    const picked = selectParentCandidates([
      { ...topLevelPage, id: "archived", archived: true },
      { ...topLevelPage, id: "trashed", in_trash: true },
      nestedPage,
    ])
    expect(picked.map((p) => p.id)).toEqual(["nested-1"])
  })

  test("skips non-page objects", () => {
    const picked = selectParentCandidates([
      { id: "db-1", object: "database", parent: { type: "workspace" } },
      topLevelPage,
    ])
    expect(picked.map((p) => p.id)).toEqual(["top-1"])
  })

  test("reads titles so an existing parent page can be adopted", () => {
    // ensureParentPage matches on this title to reuse the page it made earlier,
    // instead of building a second one beside it.
    const existing: SearchPage = {
      id: "parent-1",
      object: "page",
      parent: { type: "page_id" },
      properties: titled("MakingFlow Submissions"),
    }
    const picked = selectParentCandidates([personProfile, existing, topLevelPage])
    expect(picked.find((p) => p.title === "MakingFlow Submissions")?.id).toBe("parent-1")
  })

  test("returns nothing when only database rows are shared", () => {
    // The user-fixable state: ensureParentPage throws NotionNoParentPageError
    // rather than pushing a doomed createPage at the API.
    expect(selectParentCandidates([personProfile, databaseRow])).toEqual([])
  })

  test("tolerates a page with no title property", () => {
    const untitled: SearchPage = { id: "u-1", object: "page", parent: { type: "workspace" } }
    expect(selectParentCandidates([untitled])).toEqual([
      { id: "u-1", title: "", topLevel: true },
    ])
  })
})
