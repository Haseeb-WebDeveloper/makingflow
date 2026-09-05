/**
 * The signed export handle.
 *
 * A download link that works without a session is a bearer credential, so the
 * things that keep it safe are worth testing directly rather than only through
 * the route: that it cannot be forged, cannot be edited, and dies on schedule.
 *
 * The forgery cases are the interesting ones. Anyone who receives a link sees
 * its whole payload — the form id, the workspace, the expiry are all right
 * there in base64. The only thing stopping them setting the expiry to next year
 * or swapping in another workspace's id is the MAC over that payload.
 */

import { beforeAll, describe, expect, test } from "vitest"

const KEY = Buffer.alloc(32, 7).toString("base64")

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = KEY
})

const { mintExportToken, verifyExportToken, EXPORT_TOKEN_TTL_MS } = await import(
  "@/lib/mcp/export-token"
)

const grant = {
  formId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
  apiKeyId: "44444444-4444-4444-4444-444444444444",
}

/** Re-sign a payload the way a forger without the key cannot. */
function tamper(token: string, mutate: (claims: Record<string, unknown>) => void): string {
  const [payload, mac] = token.split(".")
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  mutate(claims)
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `${forged}.${mac}`
}

describe("export handles", () => {
  test("a freshly minted handle verifies and carries its grant back", () => {
    const result = verifyExportToken(mintExportToken(grant))
    expect(result).toMatchObject(grant)
    expect(result!.expiresAt).toBeGreaterThan(Date.now())
  })

  test("expires on schedule", () => {
    const now = 1_800_000_000_000
    const token = mintExportToken(grant, now)

    expect(verifyExportToken(token, now + EXPORT_TOKEN_TTL_MS - 1)).not.toBeNull()
    // Exactly at the expiry is already too late — `<=` rather than `<`, so a
    // token can never be used at the instant it dies.
    expect(verifyExportToken(token, now + EXPORT_TOKEN_TTL_MS)).toBeNull()
    expect(verifyExportToken(token, now + EXPORT_TOKEN_TTL_MS + 1)).toBeNull()
  })

  test("extending the expiry breaks the signature", () => {
    // The whole payload is visible to whoever holds the link. This is the
    // attack it invites, and the MAC is what refuses it.
    const token = mintExportToken(grant)
    const forged = tamper(token, (c) => {
      c.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000
    })
    expect(verifyExportToken(forged)).toBeNull()
  })

  test("swapping in another workspace breaks the signature", () => {
    const forged = tamper(mintExportToken(grant), (c) => {
      c.workspaceId = "99999999-9999-9999-9999-999999999999"
    })
    expect(verifyExportToken(forged)).toBeNull()
  })

  test("swapping in another form breaks the signature", () => {
    const forged = tamper(mintExportToken(grant), (c) => {
      c.formId = "88888888-8888-8888-8888-888888888888"
    })
    expect(verifyExportToken(forged)).toBeNull()
  })

  test("a handle signed with a different key is refused", () => {
    const token = mintExportToken(grant)
    const original = process.env.APP_ENCRYPTION_KEY
    try {
      process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
      expect(verifyExportToken(token)).toBeNull()
    } finally {
      process.env.APP_ENCRYPTION_KEY = original
    }
  })

  test("malformed input is refused rather than throwing", () => {
    // These arrive from a URL a person may have edited, truncated or mangled by
    // pasting. Every one has to be a quiet null, because a throw here is a 500
    // on a download route.
    for (const bad of [
      "",
      ".",
      "nodot",
      "..",
      "a.b",
      "!!!!.!!!!",
      Buffer.from("not json").toString("base64url") + ".sig",
      `${Buffer.from(JSON.stringify(grant)).toString("base64url")}.`,
    ]) {
      expect(verifyExportToken(bad)).toBeNull()
    }
  })

  test("a payload with no expiry is refused even if correctly signed", () => {
    // Belt and braces: if a future change ever mints without an expiry, the
    // verifier must not treat "no expiry" as "never expires".
    const token = mintExportToken(grant)
    const [, mac] = token.split(".")
    const claims = { ...grant }
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
    expect(verifyExportToken(`${payload}.${mac}`)).toBeNull()
  })

  test("two handles for the same grant differ, because the expiry moves", () => {
    const a = mintExportToken(grant, 1_800_000_000_000)
    const b = mintExportToken(grant, 1_800_000_001_000)
    expect(a).not.toBe(b)
  })
})
