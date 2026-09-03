/**
 * The save-and-resume token.
 *
 * It is keyed by FORM, not by person — localStorage has no idea who is sitting
 * at the browser. On a shared or kiosk device that meant respondent two
 * inherited respondent one's abandoned answers, which for these forms can be
 * contact details or a CV. Age expiry is half the fix (the runtimes asking
 * before restoring is the other half), so the TTL boundary is worth pinning
 * down, along with the two malformed shapes that exist in the wild.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  DRAFT_TTL_MS,
  readDraftToken,
  writeDraftToken,
  clearDraftToken,
} from "@/lib/forms/client-meta"

const PUBLIC_ID = "abc123"
const KEY = `mf:resume:${PUBLIC_ID}`

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("draft token", () => {
  test("round-trips a freshly written token", () => {
    writeDraftToken(PUBLIC_ID, "sub-1")
    const token = readDraftToken(PUBLIC_ID)
    expect(token?.id).toBe("sub-1")
    expect(token?.savedAt).toBe(Date.now())
  })

  test("a draft just inside the TTL is still offered", () => {
    writeDraftToken(PUBLIC_ID, "sub-1")
    vi.advanceTimersByTime(DRAFT_TTL_MS - 1000)
    expect(readDraftToken(PUBLIC_ID)?.id).toBe("sub-1")
  })

  test("a draft past the TTL is refused AND cleared", () => {
    writeDraftToken(PUBLIC_ID, "sub-1")
    vi.advanceTimersByTime(DRAFT_TTL_MS + 1000)
    expect(readDraftToken(PUBLIC_ID)).toBeNull()
    // Cleared, so a stale draft stops being re-offered on every later visit.
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test("the legacy bare-id format is treated as expired, not as a crash", () => {
    // Written by the build that shipped before drafts carried a timestamp.
    // Anyone mid-fill across the deploy simply starts fresh.
    localStorage.setItem(KEY, "raw-submission-id")
    expect(readDraftToken(PUBLIC_ID)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test("corrupt or partial JSON is discarded", () => {
    localStorage.setItem(KEY, "{not json")
    expect(readDraftToken(PUBLIC_ID)).toBeNull()

    localStorage.setItem(KEY, JSON.stringify({ id: "x" })) // no savedAt
    expect(readDraftToken(PUBLIC_ID)).toBeNull()

    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() })) // no id
    expect(readDraftToken(PUBLIC_ID)).toBeNull()
  })

  test("tokens are scoped per form", () => {
    writeDraftToken(PUBLIC_ID, "sub-1")
    expect(readDraftToken("someotherform")).toBeNull()
  })

  test("clearing removes it", () => {
    writeDraftToken(PUBLIC_ID, "sub-1")
    clearDraftToken(PUBLIC_ID)
    expect(readDraftToken(PUBLIC_ID)).toBeNull()
  })

  test("blocked storage degrades quietly instead of throwing", () => {
    // Safari private mode / cookie-blocked contexts throw on access. A
    // respondent there must still be able to fill the form.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => writeDraftToken(PUBLIC_ID, "sub-1")).not.toThrow()
    expect(readDraftToken(PUBLIC_ID)).toBeNull()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
