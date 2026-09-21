/**
 * The builder's link box accepts free text, and whatever it produces is stored
 * in the question and rendered to every respondent. The public runtime
 * sanitizes too, but the builder's own preview renders the same markdown — so
 * a dangerous scheme has to be refused here, not just downstream.
 */
import { describe, expect, it } from "vitest"

import { safeHref } from "@/components/builder/inline-rich-text"

describe("safeHref", () => {
  it("keeps web, mail and phone links as typed", () => {
    expect(safeHref("https://example.com/terms")).toBe("https://example.com/terms")
    expect(safeHref("http://example.com")).toBe("http://example.com")
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com")
    expect(safeHref("tel:+1555")).toBe("tel:+1555")
  })

  it("adds https:// to a bare host, which is what people type", () => {
    expect(safeHref("example.com")).toBe("https://example.com")
    expect(safeHref("  example.com/a?b=1  ")).toBe("https://example.com/a?b=1")
  })

  it("allows a same-site path or anchor", () => {
    expect(safeHref("/privacy")).toBe("/privacy")
    expect(safeHref("#details")).toBe("#details")
  })

  it("refuses a script or data URL rather than passing it through", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("JavaScript:alert(1)")).toBeNull()
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull()
    expect(safeHref("vbscript:msgbox(1)")).toBeNull()
    expect(safeHref("file:///etc/passwd")).toBeNull()
  })

  it("treats empty input as 'no link'", () => {
    expect(safeHref("")).toBeNull()
    expect(safeHref("   ")).toBeNull()
  })
})
