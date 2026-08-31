/**
 * Copying a migrated form's files onto our own storage.
 *
 * The host allowlist is the security-relevant part. The URLs come from imported
 * form data we did not author, and we hand them to Cloudinary to fetch — so an
 * open list would make this a free image proxy running on our quota, pointed at
 * whatever anyone could get into a form definition.
 */
import { describe, expect, test } from "vitest"
import { isOurs, isRehostable } from "@/lib/cloudinary/rehost"

describe("isRehostable", () => {
  test("accepts the hosts Tally serves files from", () => {
    expect(isRehostable("https://storage.tally.so/abc/cv.pdf")).toBe(true)
    expect(isRehostable("https://tally.so/logo.png")).toBe(true)
  })

  test("refuses any other host", () => {
    expect(isRehostable("https://evil.test/payload.svg")).toBe(false)
    // The suffix trick the importer's allowlist also has to survive.
    expect(isRehostable("https://storage.tally.so.evil.test/x.pdf")).toBe(false)
  })

  test("refuses anything that could reach our own network", () => {
    expect(isRehostable("http://localhost:3000/secret")).toBe(false)
    expect(isRehostable("http://169.254.169.254/latest/meta-data")).toBe(false)
    expect(isRehostable("file:///etc/passwd")).toBe(false)
  })

  test("requires https, not plain http", () => {
    expect(isRehostable("http://storage.tally.so/abc/cv.pdf")).toBe(false)
  })

  test("survives junk", () => {
    expect(isRehostable(null)).toBe(false)
    expect(isRehostable(undefined)).toBe(false)
    expect(isRehostable("")).toBe(false)
    expect(isRehostable("not a url")).toBe(false)
  })
})

describe("isOurs", () => {
  test("recognises what we already host, so a second run moves nothing", () => {
    expect(isOurs("https://res.cloudinary.com/demo/image/upload/v1/x.png")).toBe(true)
    expect(isOurs("https://storage.tally.so/abc/cv.pdf")).toBe(false)
    expect(isOurs(null)).toBe(false)
  })
})
