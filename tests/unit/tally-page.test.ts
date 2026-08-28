/**
 * Reading a Tally form from its public page.
 *
 * Two things here are security-relevant rather than merely correct: the URL is
 * user-supplied and fetched from our server, so the host allowlist is what keeps
 * this from being an SSRF gadget; and a redirect can move a request off Tally
 * after the allowlist has already passed.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  extractNextData,
  importTallyFormFromUrl,
  parseTallyUrl,
  readTallyPageProps,
  TallyImportError,
} from "@/lib/import/tally-page"
import fixture from "../fixtures/tally-form.json"

afterEach(() => vi.unstubAllGlobals())

describe("parseTallyUrl", () => {
  test("accepts the share link", () => {
    expect(parseTallyUrl("https://tally.so/r/3qDpEY")).toBe("https://tally.so/r/3qDpEY")
    expect(parseTallyUrl("https://www.tally.so/r/3qDpEY/")).toBe("https://tally.so/r/3qDpEY")
  })

  test("accepts the embed link and a bare form id", () => {
    expect(parseTallyUrl("https://tally.so/embed/3qDpEY?hideTitle=1")).toBe(
      "https://tally.so/r/3qDpEY",
    )
    expect(parseTallyUrl("3qDpEY")).toBe("https://tally.so/r/3qDpEY")
  })

  test("tolerates a pasted link with no scheme or stray spaces", () => {
    expect(parseTallyUrl("  tally.so/r/3qDpEY  ")).toBe("https://tally.so/r/3qDpEY")
  })

  test("refuses any host but Tally's", () => {
    // The allowlist is the SSRF control: without it this fetches whatever a user
    // types, from inside our network.
    expect(parseTallyUrl("http://localhost:3000/r/abc")).toBeNull()
    expect(parseTallyUrl("http://169.254.169.254/latest/meta-data")).toBeNull()
    expect(parseTallyUrl("https://tally.so.evil.test/r/abc")).toBeNull()
    expect(parseTallyUrl("https://evil.test/r/abc")).toBeNull()
  })

  test("refuses a Tally URL that isn't a form", () => {
    expect(parseTallyUrl("https://tally.so/pricing")).toBeNull()
    expect(parseTallyUrl("https://tally.so/r/")).toBeNull()
    expect(parseTallyUrl("")).toBeNull()
  })
})

describe("extractNextData", () => {
  test("pulls the payload out of the page", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"name":"Hi"}}}</script></body></html>`
    expect(extractNextData(html)).toEqual({ props: { pageProps: { name: "Hi" } } })
  })

  test("returns null when the script isn't there", () => {
    // The App Router migration this file warns about lands here — and must fail
    // loudly rather than importing an empty form.
    expect(extractNextData("<html><body>no script</body></html>")).toBeNull()
  })

  test("returns null on malformed JSON", () => {
    expect(
      extractNextData(`<script id="__NEXT_DATA__" type="application/json">{oops</script>`),
    ).toBeNull()
  })
})

describe("readTallyPageProps", () => {
  test("reads the real page payload", () => {
    const page = readTallyPageProps({ props: { pageProps: fixture } })
    expect(page?.title).toBe("Popup/embed (share)")
    expect(page?.blocks).toHaveLength(32)
    expect(page?.passwordProtected).toBe(false)
  })

  test("flags a password-protected form", () => {
    const page = readTallyPageProps({
      props: { pageProps: { name: "Secret", blocks: [], settings: { isPasswordProtected: true } } },
    })
    expect(page?.passwordProtected).toBe(true)
  })

  test("returns null when there are no blocks to read", () => {
    expect(readTallyPageProps({ props: { pageProps: { name: "x" } } })).toBeNull()
    expect(readTallyPageProps({})).toBeNull()
    expect(readTallyPageProps(null)).toBeNull()
  })
})

describe("importTallyFormFromUrl", () => {
  const page = (props: unknown, url = "https://tally.so/r/3qDpEY") => ({
    ok: true,
    status: 200,
    url,
    body: null,
    text: async () =>
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: props },
      })}</script>`,
  })

  test("imports the real form end to end", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(fixture)))
    const result = await importTallyFormFromUrl("https://tally.so/r/3qDpEY")
    expect(result.form.title).toBe("Popup/embed (share)")
    expect(result.form.fields.length).toBeGreaterThan(0)
    expect(result.sourceUrl).toBe("https://tally.so/r/3qDpEY")
  })

  test("rejects a non-Tally URL before any request is made", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(importTallyFormFromUrl("https://evil.test/r/abc")).rejects.toMatchObject({
      code: "INVALID_URL",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("refuses a redirect that lands off Tally", async () => {
    // The allowlist checks the URL we ask for; this checks the one we got.
    vi.stubGlobal("fetch", vi.fn(async () => page(fixture, "https://evil.test/phish")))
    await expect(importTallyFormFromUrl("https://tally.so/r/3qDpEY")).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  test("reports a deleted form as not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, url: "https://tally.so/r/x" })))
    await expect(importTallyFormFromUrl("https://tally.so/r/gone12")).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  test("tells the user when the form is password-protected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page({ name: "Secret", blocks: [], settings: { isPasswordProtected: true } }),
      ),
    )
    const err = await importTallyFormFromUrl("https://tally.so/r/abc123").catch((e) => e)
    expect(err).toBeInstanceOf(TallyImportError)
    expect(err.code).toBe("PASSWORD_PROTECTED")
    expect(err.message).toContain("password")
  })

  test("surfaces a network failure as unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom") }))
    await expect(importTallyFormFromUrl("https://tally.so/r/abc123")).rejects.toMatchObject({
      code: "UNREACHABLE",
    })
  })
})
