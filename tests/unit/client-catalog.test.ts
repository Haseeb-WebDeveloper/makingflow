/**
 * The per-client connect instructions.
 *
 * Two things here are worth testing, and both fail silently.
 *
 * THE OAUTH/KEY SPLIT. If a client is marked the wrong way the UI offers the
 * wrong thing, and the user cannot tell: a ChatGPT user handed an API key gets a
 * credential their client has nowhere to put, with nothing erroring anywhere.
 * That was the actual bug this whole flow was rebuilt to fix.
 *
 * THE DEEPLINKS. A malformed one does nothing when clicked — no error, no
 * feedback — and encoding is exactly where they go wrong: Cursor wants base64,
 * VS Code wants URL-encoded JSON, and neither complains about the other. So the
 * payloads are decoded back here and checked, rather than pattern-matched.
 */

import { describe, expect, test } from "vitest"
import {
  MCP_CLIENTS,
  SAMPLE_TOKEN,
  clientById,
  type McpClientInfo,
} from "@/lib/mcp/client-catalog"

const ENDPOINT = "https://makingflow.test/api/mcp"
const TOKEN = "mf_sk_live_secret-value"

const guideFor = (client: McpClientInfo) => client.install!({ endpoint: ENDPOINT, token: TOKEN })

describe("the client catalogue", () => {
  test("every client is exactly one of the two kinds, and equipped for it", () => {
    for (const client of MCP_CLIENTS) {
      expect(client.id).toBeTruthy()
      expect(client.name).toBeTruthy()
      expect(client.blurb).toBeTruthy()

      if (client.method === "oauth") {
        // Nothing is created for these, so steps are the entire content.
        expect(client.steps?.length).toBeGreaterThan(0)
        expect(client.install).toBeUndefined()
      } else {
        // These need something to paste, always — a deeplink alone is not
        // enough, since a protocol handler that does not fire leaves nothing.
        expect(client.install).toBeTypeOf("function")
        expect(guideFor(client).code).toBeTruthy()
      }
    }
  })

  test("Claude and ChatGPT are OAuth, and are never offered a key", () => {
    // The bug this flow was rebuilt around. Neither has anywhere to put one.
    for (const id of ["claude", "chatgpt"]) {
      const client = clientById(id)
      expect(client?.method).toBe("oauth")
      expect(client?.install).toBeUndefined()
    }
  })

  test("the header-based clients take a key", () => {
    for (const id of ["claude-code", "cursor", "vscode", "other"]) {
      expect(clientById(id)?.method).toBe("api-key")
    }
  })

  test("ids are unique — the UI keys its list on them", () => {
    const ids = MCP_CLIENTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe("Claude Code", () => {
    test("gives a single-line command carrying the key", () => {
      const guide = guideFor(clientById("claude-code")!)
      expect(guide.code).toContain(ENDPOINT)
      expect(guide.code).toContain(`Bearer ${TOKEN}`)
      // One line. A break inside the quotes puts a newline in the HTTP header,
      // which is the failure this whole flow keeps trying to prevent.
      expect(guide.code).not.toContain("\n")
    })
  })

  describe("Cursor", () => {
    test("the deeplink carries a base64 config Cursor can read", () => {
      const guide = guideFor(clientById("cursor")!)
      expect(guide.deeplink).toBeTruthy()

      const url = new URL(guide.deeplink!)
      expect(url.protocol).toBe("cursor:")
      expect(url.searchParams.get("name")).toBe("makingflow")

      // Decoded rather than pattern-matched: base64 that decodes to the wrong
      // shape looks perfectly fine in the URL.
      const config = JSON.parse(
        Buffer.from(url.searchParams.get("config")!, "base64").toString("utf8"),
      )
      expect(config).toEqual({
        url: ENDPOINT,
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
    })

    test("the pasteable config is valid JSON in Cursor's shape", () => {
      const guide = guideFor(clientById("cursor")!)
      expect(guide.codeLanguage).toBe("json")
      const parsed = JSON.parse(guide.code)
      expect(parsed.mcpServers.makingflow.url).toBe(ENDPOINT)
      expect(parsed.mcpServers.makingflow.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    })
  })

  describe("VS Code", () => {
    test("the deeplink carries URL-encoded JSON, not base64", () => {
      // The encodings differ between the two editors and neither complains
      // about receiving the other's.
      const guide = guideFor(clientById("vscode")!)
      const url = new URL(guide.deeplink!)
      expect(url.protocol).toBe("vscode:")

      const payload = JSON.parse(decodeURIComponent(url.href.split("?")[1]))
      expect(payload).toMatchObject({
        name: "makingflow",
        type: "http",
        url: ENDPOINT,
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
    })

    test("the pasteable config is valid JSON in VS Code's shape", () => {
      const parsed = JSON.parse(guideFor(clientById("vscode")!).code)
      expect(parsed.servers.makingflow.type).toBe("http")
      expect(parsed.servers.makingflow.url).toBe(ENDPOINT)
    })
  })

  test("a deeplink is never the only route — the config is always shown too", () => {
    for (const client of MCP_CLIENTS) {
      const guide = client.install?.({ endpoint: ENDPOINT, token: TOKEN })
      if (guide?.deeplink) {
        expect(guide.deeplinkLabel).toBeTruthy()
        expect(guide.code).toBeTruthy()
        // And the note says what to do when the button does nothing, because a
        // protocol handler failing to fire produces no feedback at all.
        expect(guide.note).toBeTruthy()
      }
    }
  })

  test("every deeplink is a parseable URL", () => {
    for (const client of MCP_CLIENTS) {
      const deeplink = client.install?.({ endpoint: ENDPOINT, token: TOKEN }).deeplink
      if (deeplink) expect(() => new URL(deeplink)).not.toThrow()
    }
  })

  test("the docs placeholder is obviously not a real key", () => {
    // Rendered on a public page. It must not look like something to try.
    expect(SAMPLE_TOKEN).toContain("...")
    for (const client of MCP_CLIENTS) {
      const guide = client.install?.({ endpoint: ENDPOINT, token: SAMPLE_TOKEN })
      if (guide) expect(guide.code).toContain(SAMPLE_TOKEN)
    }
  })

  test("no client's instructions leak a token into the endpoint URL itself", () => {
    // A key belongs in a header. In a URL it lands in server logs, browser
    // history and referrers.
    for (const client of MCP_CLIENTS) {
      const guide = client.install?.({ endpoint: ENDPOINT, token: TOKEN })
      if (!guide) continue
      expect(guide.code).not.toContain(`${ENDPOINT}?`)
      expect(guide.deeplink ?? "").not.toContain(`${ENDPOINT}?`)
    }
  })
})
