/**
 * The Drive sharing calls, and the two things about them that are easy to get
 * wrong and invisible when you do: the shared-drive flag, and turning Google's
 * status codes into something a person can act on.
 *
 * The flag is not hypothetical. A spreadsheet in a Google Workspace shared drive
 * answers `404 File not found` to every Drive call that omits it, while the
 * Sheets API reads the same file happily — so the feature would work in testing
 * and fail for the customers most likely to want it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { DriveShareError, shareFile, unshareFile } from "@/lib/integrations/google"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}
function err(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe("shareFile", () => {
  test("grants the role to the email and returns the permission id", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "perm-1" }))

    const res = await shareFile("token", "file-1", "a@b.com", "reader")

    expect(res).toEqual({ permissionId: "perm-1" })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("supportsAllDrives=true")
    expect(url).toContain("sendNotificationEmail=false")
    expect(JSON.parse(init.body as string)).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "a@b.com",
    })
  })

  test("a domain policy refusal is reported as such, not as a generic failure", async () => {
    fetchMock.mockReturnValueOnce(
      err(403, {
        error: {
          code: 403,
          message:
            "The domain administrators have disabled Drive apps sharing outside of the domain.",
        },
      }),
    )

    await expect(shareFile("token", "file-1", "a@gmail.com", "reader")).rejects.toMatchObject({
      kind: "domain_policy",
    })
  })

  test("an address Google won't accept is reported as not a Google account", async () => {
    fetchMock.mockReturnValueOnce(
      err(400, { error: { code: 400, message: "Invalid sharing request" } }),
    )

    await expect(
      shareFile("token", "file-1", "nope@nowhere.test", "reader"),
    ).rejects.toMatchObject({ kind: "not_a_google_account" })
  })

  test("anything else is a plain failure", async () => {
    fetchMock.mockReturnValueOnce(err(500, { error: { code: 500, message: "backend error" } }))

    await expect(shareFile("token", "file-1", "a@b.com", "reader")).rejects.toMatchObject({
      kind: "failed",
    })
  })

  test("the thrown error is a DriveShareError", async () => {
    fetchMock.mockReturnValueOnce(err(500, { error: { message: "nope" } }))

    await expect(shareFile("token", "file-1", "a@b.com", "reader")).rejects.toBeInstanceOf(
      DriveShareError,
    )
  })
})

describe("unshareFile", () => {
  test("removes the permission", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })))

    await unshareFile("token", "file-1", "perm-1")

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/files/file-1/permissions/perm-1")
    expect(url).toContain("supportsAllDrives=true")
    expect(init.method).toBe("DELETE")
  })

  test("a permission that is already gone is the outcome we wanted", async () => {
    fetchMock.mockReturnValueOnce(err(404, { error: { code: 404, message: "not found" } }))

    await expect(unshareFile("token", "file-1", "perm-1")).resolves.toBeUndefined()
  })

  test("a real failure still surfaces", async () => {
    fetchMock.mockReturnValueOnce(err(500, { error: { code: 500, message: "backend error" } }))

    await expect(unshareFile("token", "file-1", "perm-1")).rejects.toBeInstanceOf(DriveShareError)
  })
})
