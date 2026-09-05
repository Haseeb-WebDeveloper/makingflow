/**
 * The outbound-URL guard.
 *
 * This exists because of who the caller became. A webhook URL used to be typed
 * by a human with a browser session, into their own endpoint. Once an MCP tool
 * can set one, the caller is a model that can be argued with — and
 * `send_test_webhook` reports the HTTP status of whatever it reached, which
 * turns "add a webhook and test it" into a working SSRF probe of anything our
 * server can see.
 */

import { describe, expect, test } from "vitest"
import { checkOutboundUrl } from "@/lib/core/outbound-url"

describe("checkOutboundUrl", () => {
  test.each([
    "https://example.com/hooks/abc",
    "http://example.com:8080/path?x=1",
    "https://hooks.slack.com/services/T000/B000/xxxx",
    "https://sub.domain.co.uk/webhook",
  ])("allows the real destinations people use: %s", (url) => {
    expect(checkOutboundUrl(url).ok).toBe(true)
  })

  test.each([
    ["http://localhost/hook", "loopback by name"],
    ["http://localhost.localdomain/hook", "loopback alias"],
    ["http://127.0.0.1/hook", "loopback"],
    ["http://127.1.2.3/hook", "the whole 127/8 block, not just .0.1"],
    ["http://0.0.0.0/hook", "this network"],
    ["http://10.0.0.5/hook", "private 10/8"],
    ["http://172.16.4.9/hook", "private 172.16/12"],
    ["http://172.31.255.1/hook", "top of 172.16/12"],
    ["http://192.168.1.1/hook", "private 192.168/16"],
    ["http://100.100.0.1/hook", "carrier NAT"],
    ["http://[::1]/hook", "IPv6 loopback"],
    ["http://[fd00::1]/hook", "IPv6 unique local"],
    ["http://[fe80::1]/hook", "IPv6 link-local"],
    ["http://[::ffff:127.0.0.1]/hook", "IPv4-mapped IPv6 — bypasses a naive v4 check"],
    ["http://intranet/hook", "unqualified internal name"],
  ])("blocks %s (%s)", (url) => {
    const result = checkOutboundUrl(url)
    expect(result.ok).toBe(false)
  })

  test("blocks the cloud metadata address specifically", () => {
    // 169.254.169.254 is the single most valuable SSRF target on any cloud
    // host: it hands out instance credentials to anything that asks.
    expect(checkOutboundUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false)
    expect(checkOutboundUrl("http://metadata.google.internal/computeMetadata/v1/").ok).toBe(false)
  })

  test.each(["ftp://example.com/x", "file:///etc/passwd", "gopher://example.com", "javascript:alert(1)"])(
    "rejects non-http schemes: %s",
    (url) => {
      expect(checkOutboundUrl(url).ok).toBe(false)
    },
  )

  test("rejects things that are not URLs at all", () => {
    expect(checkOutboundUrl("").ok).toBe(false)
    expect(checkOutboundUrl("not a url").ok).toBe(false)
  })

  test("normalises, so what is stored is what will be called", () => {
    const result = checkOutboundUrl("  https://example.com/hook  ")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe("https://example.com/hook")
  })
})
