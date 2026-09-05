/**
 * The proxy auth gate, and the two ways it silently broke OAuth.
 *
 * Both were found by probing the deployed server, not by any test — which is
 * why they are pinned here now. Neither produced an error anywhere: the gate did
 * exactly what it was written to do, to requests it was never meant to see.
 *
 *   1. It answered /api/oauth/register and /api/oauth/token with a 307 to an
 *      HTML login page. Those are machine-to-machine calls with no browser and
 *      no cookie, so a client either fails to parse the response or — worse —
 *      reads the 200 that follows the redirect as success.
 *
 *   2. It rebuilt `redirectTo` from the PATH alone, dropping the query. For most
 *      pages that is a small annoyance. For /oauth/consent the query IS the
 *      request — client_id, redirect_uri, code_challenge, state — so signing in
 *      returned the user to a consent form with nothing to consent to.
 */

import { describe, expect, test } from "vitest"
import { NextRequest } from "next/server"
import { handleProxyAuth } from "@/lib/supabase/middleware"

/** A request with no Supabase cookie — the case the gate acts on. */
function anonymous(url: string) {
  return handleProxyAuth(new NextRequest(new URL(url, "https://makingflow.test")))
}

describe("the proxy auth gate", () => {
  describe("machine-to-machine endpoints are never gated", () => {
    test.each([
      "/api/oauth/register",
      "/api/oauth/token",
      "/api/oauth/revoke",
      "/api/oauth/authorize",
      "/api/mcp",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ])("%s passes through", (path) => {
      const response = anonymous(path)
      // Not a redirect. An HTTP client sent to a login page reports something
      // that looks nothing like the actual problem.
      expect(response.status).toBe(200)
      expect(response.headers.get("location")).toBeNull()
    })

    test("/api/oauth/authorize handles its own sign-in, query intact", () => {
      // It IS a browser request and does need a session — but the parameters
      // are the authorization request, and this gate would drop them.
      const response = anonymous(
        "/api/oauth/authorize?response_type=code&client_id=abc&code_challenge=xyz",
      )
      expect(response.status).toBe(200)
    })
  })

  describe("browser pages are gated, and come back to where they were", () => {
    test("keeps the query string on the way to login", () => {
      const response = anonymous(
        "/oauth/consent?client_id=abc&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=s",
      )
      expect(response.status).toBe(307)

      const location = new URL(response.headers.get("location")!)
      expect(location.pathname).toBe("/auth/login")

      const back = location.searchParams.get("redirectTo")!
      expect(back).toContain("/oauth/consent")
      // Without these the user signs in and lands on a form with nothing to
      // submit, which reads as "the app is broken" rather than "we lost your
      // parameters".
      expect(back).toContain("client_id=abc")
      expect(back).toContain("state=s")
    })

    test("redirectTo stays a same-origin relative path", () => {
      // The login form only accepts values starting with a single "/", so this
      // must not become absolute when the query is appended.
      const response = anonymous("/forms?folder=abc")
      const back = new URL(response.headers.get("location")!).searchParams.get("redirectTo")!
      expect(back.startsWith("/")).toBe(true)
      expect(back.startsWith("//")).toBe(false)
      expect(back).toBe("/forms?folder=abc")
    })

    test("a page with no query is unchanged", () => {
      const response = anonymous("/forms")
      const back = new URL(response.headers.get("location")!).searchParams.get("redirectTo")!
      expect(back).toBe("/forms")
    })
  })

  test("a request carrying a session cookie is let through", () => {
    const request = new NextRequest(new URL("/forms", "https://makingflow.test"))
    request.cookies.set("sb-access-token", "whatever")
    expect(handleProxyAuth(request).status).toBe(200)
  })
})
