/**
 * The dedup key for the Notion backfill.
 *
 * `backfillFormNotionDatabase` writes one page per historical submission, using
 * the submission id in the title property as its identity. It decides what to
 * write by diffing that set against the database's current contents, so a bug
 * in reading those titles doesn't fail loudly — it silently re-writes pages that
 * are already there, and every re-run doubles the duplicates.
 *
 * A per-submission `queryDatabaseByTitle` would sidestep pagination entirely,
 * but at one request per row it would double the cost of the backfill and spend
 * the rate-limit budget on rows we then skip. Hence one paged scan — and hence
 * these tests, which pin the paging contract.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { listDatabaseTitles } from "@/lib/integrations/notion"

type Body = { page_size?: number; start_cursor?: string }

const titleRow = (id: string) => ({
  id: `page-${id}`,
  properties: { Submission: { title: [{ plain_text: id }] } },
})

/** Stub fetch with one canned response per call, capturing request bodies. */
function stubNotion(pages: unknown[]) {
  const bodies: Body[] = []
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body) as Body)
    return {
      ok: true,
      json: async () => pages[bodies.length - 1] ?? { results: [] },
    }
  })
  vi.stubGlobal("fetch", fetchMock)
  return { bodies, fetchMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("listDatabaseTitles", () => {
  test("returns the submission ids already synced", async () => {
    stubNotion([{ results: [titleRow("sub-a"), titleRow("sub-b")], has_more: false }])
    const seen = await listDatabaseTitles("tok", "db-1", "Submission")
    expect([...seen].sort()).toEqual(["sub-a", "sub-b"])
  })

  test("follows next_cursor and sends it only after the first page", async () => {
    const { bodies } = stubNotion([
      { results: [titleRow("sub-a")], has_more: true, next_cursor: "cur-1" },
      { results: [titleRow("sub-b")], has_more: true, next_cursor: "cur-2" },
      { results: [titleRow("sub-c")], has_more: false },
    ])
    const seen = await listDatabaseTitles("tok", "db-1", "Submission")

    expect([...seen].sort()).toEqual(["sub-a", "sub-b", "sub-c"])
    // Omitted on the first request — Notion rejects a null start_cursor.
    expect(bodies[0].start_cursor).toBeUndefined()
    expect(bodies.map((b) => b.start_cursor)).toEqual([undefined, "cur-1", "cur-2"])
  })

  test("stops when has_more is true but no cursor comes back", async () => {
    // Defensive: without this the loop would re-request page 1 forever, and the
    // caller (a background backfill) has nobody watching it.
    const { fetchMock } = stubNotion([
      { results: [titleRow("sub-a")], has_more: true, next_cursor: null },
    ])
    await listDatabaseTitles("tok", "db-1", "Submission")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("honours the page cap on a database grown by hand", async () => {
    const endless = Array.from({ length: 10 }, (_, i) => ({
      results: [titleRow(`sub-${i}`)],
      has_more: true,
      next_cursor: `cur-${i}`,
    }))
    const { fetchMock } = stubNotion(endless)
    const seen = await listDatabaseTitles("tok", "db-1", "Submission", 3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(seen.size).toBe(3)
  })

  test("ignores rows whose title property is empty or absent", async () => {
    // A blank id would match nothing, but an empty string in the set is a
    // liability if the property is ever renamed — keep it out.
    stubNotion([
      {
        results: [
          titleRow("sub-a"),
          { id: "page-x", properties: { Submission: { title: [] } } },
          { id: "page-y", properties: {} },
          { id: "page-z" },
        ],
        has_more: false,
      },
    ])
    const seen = await listDatabaseTitles("tok", "db-1", "Submission")
    expect([...seen]).toEqual(["sub-a"])
    expect(seen.has("")).toBe(false)
  })

  test("reads the configured title property, not a hard-coded name", async () => {
    // titlePropertyName is stored per form because Notion lets a user rename it.
    // Reading the wrong property returns an empty set, which reads as "nothing
    // synced yet" and re-writes the entire history.
    const page = {
      results: [{ id: "p1", properties: { Response: { title: [{ plain_text: "sub-a" }] } } }],
      has_more: false,
    }

    stubNotion([page])
    expect([...(await listDatabaseTitles("tok", "db-1", "Response"))]).toEqual(["sub-a"])

    vi.unstubAllGlobals()
    stubNotion([page])
    expect([...(await listDatabaseTitles("tok", "db-1", "Submission"))]).toEqual([])
  })
})
