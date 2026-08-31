/**
 * Reading Tally with an API key.
 *
 * Two things here are security-relevant rather than merely correct. A Tally API
 * key is UNSCOPED — it can delete the forms and responses it can read — so this
 * module must never issue anything but GET, and must never put the key
 * somewhere it could be logged or shown. Both are asserted below, because both
 * are the kind of property that quietly stops holding during a refactor.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  fetchTallyFormFromApi,
  fetchTallySubmissions,
  isPlausibleApiKey,
  listTallyForms,
} from "@/lib/import/tally-api"
import { TallyImportError } from "@/lib/import/tally-error"
import fixture from "../fixtures/tally-form.json"

const KEY = "tly-abc123def456ghi789jkl012"

afterEach(() => vi.unstubAllGlobals())

/** Stub fetch with a queue of JSON bodies, one per call, and record the calls. */
function stubJson(...bodies: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  let i = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: url.toString(), init })
      const body = bodies[Math.min(i, bodies.length - 1)]
      i += 1
      return { ok: true, status: 200, json: async () => body }
    }),
  )
  return calls
}

function stubStatus(status: number) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, json: async () => ({}) })))
}

describe("isPlausibleApiKey", () => {
  test("accepts a realistic key", () => {
    expect(isPlausibleApiKey(KEY)).toBe(true)
    expect(isPlausibleApiKey(`  ${KEY}  `)).toBe(true)
  })

  test("rejects what could never be a key", () => {
    expect(isPlausibleApiKey("")).toBe(false)
    expect(isPlausibleApiKey("short")).toBe(false)
    // A header value cannot hold these; catching them here beats a fetch throw.
    expect(isPlausibleApiKey("tly-abc123def456ghi\n789jkl")).toBe(false)
    expect(isPlausibleApiKey("tly abc123def456ghi789jkl")).toBe(false)
  })

  test("refuses to spend a request on an implausible key", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(listTallyForms("nope")).rejects.toMatchObject({ code: "INVALID_KEY" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("requests", () => {
  test("authenticates with a bearer token and only ever reads", async () => {
    const calls = stubJson({ items: [], hasMore: false })
    await listTallyForms(KEY)

    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe("GET")
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${KEY}`)
  })

  test("maps every failure to a reason the user can act on", async () => {
    const cases: [number, string][] = [
      [401, "INVALID_KEY"],
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [429, "RATE_LIMITED"],
      [500, "UNREACHABLE"],
    ]
    for (const [status, code] of cases) {
      stubStatus(status)
      await expect(listTallyForms(KEY)).rejects.toMatchObject({ code })
      vi.unstubAllGlobals()
    }
  })

  test("never puts the key in the error it throws", async () => {
    // The message is shown to the user and written to logs by the caller.
    stubStatus(401)
    const err = await listTallyForms(KEY).catch((e) => e)
    expect(err).toBeInstanceOf(TallyImportError)
    expect(JSON.stringify({ m: err.message, s: err.stack })).not.toContain(KEY)
  })

  test("treats a network failure and unreadable JSON alike", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom") }))
    await expect(listTallyForms(KEY)).rejects.toMatchObject({ code: "UNREACHABLE" })
    vi.unstubAllGlobals()

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("html") } })),
    )
    await expect(listTallyForms(KEY)).rejects.toMatchObject({ code: "UNREACHABLE" })
  })
})

describe("listTallyForms", () => {
  test("reads a page of forms", async () => {
    stubJson({
      items: [
        {
          id: "wA5bYz",
          name: "  Job application  ",
          status: "PUBLISHED",
          isClosed: false,
          numberOfSubmissions: 128,
        },
      ],
      hasMore: false,
    })
    expect(await listTallyForms(KEY)).toEqual([
      {
        id: "wA5bYz",
        name: "Job application",
        status: "PUBLISHED",
        isClosed: false,
        submissionCount: 128,
      },
    ])
  })

  test("follows pagination until hasMore is false", async () => {
    const calls = stubJson(
      { items: [{ id: "a", name: "A" }], hasMore: true },
      { items: [{ id: "b", name: "B" }], hasMore: false },
    )
    const forms = await listTallyForms(KEY)
    expect(forms.map((f) => f.id)).toEqual(["a", "b"])
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toContain("page=2")
  })

  test("survives a form row missing everything but an id", async () => {
    stubJson({ items: [{ id: "a" }, { name: "no id" }], hasMore: false })
    expect(await listTallyForms(KEY)).toEqual([
      { id: "a", name: "Untitled form", status: "", isClosed: false, submissionCount: 0 },
    ])
  })
})

describe("fetchTallyFormFromApi", () => {
  test("parses the same blocks the public page carries", async () => {
    // The point of the shared parser: this fixture was captured from a public
    // page and is fed here through the API reader unchanged.
    stubJson({ name: "Popup/embed (share)", blocks: fixture.blocks, settings: {} })
    const result = await fetchTallyFormFromApi(KEY, "3qDpEY")
    expect(result.form.title).toBe("Popup/embed (share)")
    expect(result.form.fields.length).toBeGreaterThan(0)
    expect(result.refs.length).toBe(
      result.form.fields.filter((f) => !["heading", "paragraph", "image", "page_break"].includes(f.type)).length,
    )
  })

  test("records the block group each field came from", async () => {
    stubJson({ name: "x", blocks: fixture.blocks, settings: {} })
    const { refs } = await fetchTallyFormFromApi(KEY, "3qDpEY")
    // Without these the API path would have to fall back to matching label text.
    expect(refs.every((r) => typeof r.groupUuid === "string" && r.groupUuid.length > 0)).toBe(true)
  })

  test("fails loudly when there are no blocks to read", async () => {
    stubJson({ name: "x" })
    await expect(fetchTallyFormFromApi(KEY, "abc")).rejects.toMatchObject({
      code: "NO_DEFINITION",
    })
  })
})

describe("fetchTallySubmissions", () => {
  const page = (ids: string[], hasMore: boolean) => ({
    questions: [{ id: "Q1", title: "Name", fields: [{ blockGroupUuid: "g1" }] }],
    submissions: ids.map((id) => ({ id, isCompleted: true, responses: [] })),
    hasMore,
  })

  test("asks only for completed responses", async () => {
    const calls = stubJson(page(["s1"], false))
    await fetchTallySubmissions(KEY, "abc")
    expect(calls[0].url).toContain("filter=completed")
    expect(calls[0].url).toContain("limit=500")
  })

  test("collects pages and keeps one copy of the questions", async () => {
    stubJson(page(["s1"], true), page(["s2"], false))
    const result = await fetchTallySubmissions(KEY, "abc")
    expect(result.submissions.map((s) => s.id)).toEqual(["s1", "s2"])
    expect(result.questions).toHaveLength(1)
    expect(result.truncated).toBe(false)
  })

  test("stops at the cap and says there is more", async () => {
    stubJson(page(["s1", "s2", "s3"], true))
    const result = await fetchTallySubmissions(KEY, "abc", 2)
    expect(result.submissions).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  test("stops when a page comes back empty", async () => {
    // hasMore can stay true on a form whose last page is empty; without this
    // guard the loop would spend every remaining request on nothing.
    const calls = stubJson(page([], true))
    const result = await fetchTallySubmissions(KEY, "abc")
    expect(calls).toHaveLength(1)
    expect(result.submissions).toEqual([])
  })
})
