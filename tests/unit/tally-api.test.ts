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
  listTallyWorkspaces,
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
      return { ok: true, status: 200, headers: new Headers(), json: async () => body }
    }),
  )
  return calls
}

function stubStatus(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status, headers: new Headers(), json: async () => ({}) })),
  )
}

/** listTallyForms reads /workspaces first, for the folder names. */
const NO_WORKSPACES = { items: [] }

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
    const calls = stubJson(NO_WORKSPACES, { items: [], hasMore: false })
    await listTallyForms(KEY)

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      // A Tally key can delete what it can read. This module must never be able
      // to express anything but a read.
      expect(call.init.method).toBe("GET")
      expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    }
  })

  test("retries a rate-limit before giving up on it", async () => {
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1
        // Rate-limited twice, then fine — the shape of a real busy minute.
        if (calls <= 2) return { ok: false, status: 429, headers: new Headers(), json: async () => ({}) }
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ items: [], hasMore: false }) }
      }),
    )
    await expect(listTallyWorkspaces(KEY)).resolves.toBeInstanceOf(Map)
    expect(calls).toBe(3)
  })

  test("gives up on a rate-limit that will not clear", async () => {
    stubStatus(429)
    await expect(listTallyWorkspaces(KEY)).rejects.toMatchObject({ code: "RATE_LIMITED" })
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
  const WORKSPACES = {
    items: [
      { id: "mOPMgM", name: "HR - FIGMENTA", folders: [] },
      { id: "w8AJQk", name: "SENIOR- FIGMENTA", folders: [{ id: "fold1", name: "Archive" }] },
    ],
  }

  test("names each form's group from its workspace", async () => {
    stubJson(WORKSPACES, {
      items: [
        {
          id: "wA5bYz",
          name: "  Job application  ",
          workspaceId: "mOPMgM",
          folderId: null,
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
        workspaceId: "mOPMgM",
        workspaceName: "HR - FIGMENTA",
      },
    ])
  })

  test("asks /workspaces for nothing but the workspaces", async () => {
    // This endpoint rejects `limit` with a 400 where /forms requires it. The
    // caller swallows workspace failures, so sending one cost a real migration
    // its folders and said nothing.
    const calls = stubJson(WORKSPACES, { items: [], hasMore: false })
    await listTallyForms(KEY)
    const ws = calls.find((c) => c.url.includes("/workspaces"))
    expect(ws).toBeDefined()
    expect(ws!.url).toBe("https://api.tally.so/workspaces")
  })

  test("prefers the folder over the workspace when a form is filed in one", async () => {
    stubJson(WORKSPACES, {
      items: [{ id: "a", name: "A", workspaceId: "w8AJQk", folderId: "fold1" }],
      hasMore: false,
    })
    const [form] = await listTallyForms(KEY)
    expect(form.workspaceName).toBe("Archive")
  })

  test("still lists the forms when workspaces cannot be read", async () => {
    // Losing the folder names is a worse outcome than losing the import.
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1
        if (call === 1) return { ok: false, status: 403, headers: new Headers(), json: async () => ({}) }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ items: [{ id: "a", name: "A" }], hasMore: false }),
        }
      }),
    )
    const forms = await listTallyForms(KEY)
    expect(forms.map((f) => f.id)).toEqual(["a"])
    expect(forms[0].workspaceName).toBeNull()
  })

  test("follows pagination until hasMore is false", async () => {
    const calls = stubJson(
      NO_WORKSPACES,
      { items: [{ id: "a", name: "A" }], hasMore: true },
      { items: [{ id: "b", name: "B" }], hasMore: false },
    )
    const forms = await listTallyForms(KEY)
    expect(forms.map((f) => f.id)).toEqual(["a", "b"])
    expect(calls[calls.length - 1].url).toContain("page=2")
  })

  test("survives a form row missing everything but an id", async () => {
    stubJson(NO_WORKSPACES, { items: [{ id: "a" }, { name: "no id" }], hasMore: false })
    expect(await listTallyForms(KEY)).toEqual([
      {
        id: "a",
        name: "Untitled form",
        status: "",
        isClosed: false,
        submissionCount: 0,
        workspaceId: null,
        workspaceName: null,
      },
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
    expect(result.nextPage).toBeNull()
  })

  test("stops once it has enough and says where to resume", async () => {
    // The account this was built against has a form with 3,142 responses — more
    // than one request can carry — so "how do I continue" has to be part of the
    // answer, not a truncation the caller can only report.
    stubJson(page(["s1", "s2", "s3"], true))
    const result = await fetchTallySubmissions(KEY, "abc", { max: 2 })
    expect(result.nextPage).toBe(2)
  })

  test("resumes from the page it was given", async () => {
    const calls = stubJson(page(["s9"], false))
    const result = await fetchTallySubmissions(KEY, "abc", { startPage: 4 })
    expect(calls[0].url).toContain("page=4")
    expect(result.nextPage).toBeNull()
  })

  test("stops when a page comes back empty", async () => {
    // hasMore can stay true on a form whose last page is empty; without this
    // guard the loop would spend every remaining request on nothing.
    const calls = stubJson(page([], true))
    const result = await fetchTallySubmissions(KEY, "abc")
    expect(calls).toHaveLength(1)
    expect(result.submissions).toEqual([])
    expect(result.nextPage).toBeNull()
  })
})
