/**
 * The workspace logo URL gate.
 *
 * Uploads go straight from the browser to an unsigned Cloudinary preset, so the
 * URL that reaches `setWorkspaceLogo` is whatever the client chose to post. It
 * is then stored and rendered as an `<img src>` in the sidebar of every page for
 * every member of the workspace, so this check is the only thing standing
 * between a member and pointing that tag anywhere they like.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { cldDeliver, isCloudinaryUrl } from "@/lib/cloudinary/url"
import { workspaceSlug, isUniqueViolation } from "@/lib/workspaces/slug"

const CLOUD = "test-cloud"
const original = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME

beforeEach(() => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = CLOUD
})
afterEach(() => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = original
})

describe("isCloudinaryUrl", () => {
  test("accepts a delivery URL from our own cloud", () => {
    expect(
      isCloudinaryUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/makingflow/logos/a.png`),
    ).toBe(true)
  })

  test("refuses another Cloudinary account", () => {
    expect(
      isCloudinaryUrl("https://res.cloudinary.com/someone-else/image/upload/v1/x.png"),
    ).toBe(false)
    // Prefix, not a path segment — must not satisfy the cloud-name check.
    expect(
      isCloudinaryUrl(`https://res.cloudinary.com/${CLOUD}-evil/image/upload/v1/x.png`),
    ).toBe(false)
  })

  test("refuses a host that merely mentions cloudinary", () => {
    // The substring test in rehost.ts's isOurs() passes all of these, which is
    // exactly why it can't be reused as an authorization gate.
    expect(isCloudinaryUrl(`https://evil.test/?x=res.cloudinary.com/${CLOUD}/`)).toBe(false)
    expect(isCloudinaryUrl(`https://res.cloudinary.com.evil.test/${CLOUD}/a.png`)).toBe(false)
    expect(isCloudinaryUrl(`https://evil.test/res.cloudinary.com/${CLOUD}/a.png`)).toBe(false)
  })

  test("refuses anything that could reach our own network", () => {
    expect(isCloudinaryUrl("http://localhost:3000/secret")).toBe(false)
    expect(isCloudinaryUrl("http://169.254.169.254/latest/meta-data")).toBe(false)
    expect(isCloudinaryUrl("file:///etc/passwd")).toBe(false)
    expect(isCloudinaryUrl(`javascript:alert(1)//res.cloudinary.com/${CLOUD}/`)).toBe(false)
  })

  test("requires https", () => {
    expect(isCloudinaryUrl(`http://res.cloudinary.com/${CLOUD}/image/upload/v1/a.png`)).toBe(false)
  })

  test("survives junk", () => {
    expect(isCloudinaryUrl("")).toBe(false)
    expect(isCloudinaryUrl("not a url")).toBe(false)
    expect(isCloudinaryUrl(`https://res.cloudinary.com/${CLOUD}/${"a".repeat(2100)}`)).toBe(false)
  })

  test("fails closed when the cloud name is unset", () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    expect(
      isCloudinaryUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.png`),
    ).toBe(false)
  })
})

describe("cldDeliver", () => {
  test("injects the transform after the upload marker", () => {
    expect(
      cldDeliver(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.png`, "f_auto,q_auto"),
    ).toBe(`https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/v1/a.png`)
  })

  test("leaves SVGs alone — rasterizing a vector logo blurs it", () => {
    const svg = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/logo.svg`
    expect(cldDeliver(svg, "f_auto,q_auto")).toBe(svg)
  })

  test("no-ops on a non-Cloudinary URL", () => {
    expect(cldDeliver("https://example.test/a.png", "f_auto")).toBe("https://example.test/a.png")
  })
})

describe("workspaceSlug", () => {
  test("normalizes a name into a slug with a random suffix", () => {
    expect(workspaceSlug("Acme Corp")).toMatch(/^acme-corp-[0-9a-f]{6}$/)
  })

  test("caps the base at 32 characters", () => {
    const [base] = workspaceSlug("a".repeat(80)).split(/-(?=[0-9a-f]{6}$)/)
    expect(base).toHaveLength(32)
  })

  test("falls back when the name has nothing sluggable", () => {
    expect(workspaceSlug("!!! ???")).toMatch(/^workspace-[0-9a-f]{6}$/)
  })

  test("two calls for the same name differ", () => {
    expect(workspaceSlug("Acme")).not.toBe(workspaceSlug("Acme"))
  })
})

describe("isUniqueViolation", () => {
  test("recognizes 23505, directly and nested under cause", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true)
    expect(
      isUniqueViolation(
        Object.assign(new Error("wrapped"), { cause: { code: "23505" } }),
      ),
    ).toBe(true)
  })

  test("ignores anything else", () => {
    expect(isUniqueViolation(Object.assign(new Error("nope"), { code: "23503" }))).toBe(false)
    expect(isUniqueViolation(new Error("plain"))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation("23505")).toBe(false)
  })
})
