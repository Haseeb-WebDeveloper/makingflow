/**
 * The post-submit redirect destination.
 *
 * This guard exists because of HOW the value is used. The runtimes hand it
 * straight to `window.location`, which resolves anything scheme-less against
 * the form's own page — so a saved "example.com/thanks" sent respondents to
 * /f/<publicId>/example.com/thanks, a 404, AFTER their answer was recorded.
 * The owner never sees it: the builder preview disables redirecting.
 *
 * Mirrors `safeHref` (the builder's link box) deliberately — a bare host
 * becomes https:// because that is what people type — but is stricter: a
 * relative path or an anchor is the bug itself, and mailto:/tel: are not
 * somewhere a browser can be sent after a submit.
 */

import { describe, expect, test } from "vitest"
import { normalizeRedirectUrl, usableRedirectUrl } from "@/lib/core/redirect-url"

describe("normalizeRedirectUrl", () => {
  test.each([
    "https://example.com/thank-you",
    "http://example.com:8080/done?ref=1",
    "https://sub.domain.co.uk/a#b",
  ])("keeps a full web address as typed: %s", (url) => {
    const res = normalizeRedirectUrl(url)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.url).toBe(url)
  })

  test("adds https:// to a bare host, which is what people type", () => {
    expect(normalizeRedirectUrl("example.com/thanks")).toEqual({
      ok: true,
      url: "https://example.com/thanks",
    })
    expect(normalizeRedirectUrl("  example.com  ")).toEqual({
      ok: true,
      url: "https://example.com/",
    })
  })

  test.each(["/thanks", "#done", "f/abc"])(
    "refuses a relative destination — this is the reported bug: %s",
    (url) => {
      expect(normalizeRedirectUrl(url).ok).toBe(false)
    },
  )

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "mailto:hi@example.com",
    "tel:+1555",
  ])("refuses a scheme a submit cannot send a browser to: %s", (url) => {
    expect(normalizeRedirectUrl(url).ok).toBe(false)
  })

  test.each(["", "   ", "thank you", "http://"])("refuses unusable input: %s", (url) => {
    expect(normalizeRedirectUrl(url).ok).toBe(false)
  })
})

describe("usableRedirectUrl", () => {
  test("repairs a row stored before the guard existed, so it stops 404-ing", () => {
    // Exactly the row the reported bug produced: handing it back as-is would
    // navigate relative all over again.
    expect(usableRedirectUrl("example.com/thanks")).toBe("https://example.com/thanks")
  })

  test("drops a destination that cannot be repaired", () => {
    expect(usableRedirectUrl("javascript:alert(1)")).toBeNull()
    expect(usableRedirectUrl("/thanks")).toBeNull()
  })

  test("passes a good destination through untouched", () => {
    expect(usableRedirectUrl("https://example.com/thanks")).toBe("https://example.com/thanks")
  })

  test("treats no redirect as no redirect", () => {
    expect(usableRedirectUrl(null)).toBeNull()
    expect(usableRedirectUrl("")).toBeNull()
  })
})
