import "server-only"

/**
 * Short-lived, signed download handles for CSV exports.
 *
 * The alternative — returning the CSV inline from the tool — is worse in three
 * separate ways, which is why this exists at all. An export is unbounded: a form
 * with 20,000 responses produces megabytes, and a tool result goes straight into
 * a context window. Every cell is respondent PII, so an export the user glanced
 * at once would sit in the conversation forever. And a model that receives the
 * whole file will summarise it back, doubling the exposure.
 *
 * So the tool returns a URL. What matters is that the URL is not itself a way
 * around the permission system:
 *
 *   - It is signed with APP_ENCRYPTION_KEY (HMAC-SHA256), so it cannot be
 *     forged or edited — changing the form id or the expiry breaks the MAC.
 *   - It carries the workspace AND the user it was minted for. The download
 *     route re-checks the form against that workspace, so a token cannot be
 *     replayed against another tenant even if the signature is valid.
 *   - It expires in fifteen minutes. Long enough for a person to click a link
 *     an assistant just gave them; short enough that a link pasted into a
 *     shared transcript is dead before anyone else finds it.
 *   - It is bound to the API key that minted it, so revoking a key kills every
 *     link it ever handed out.
 *
 * A signed URL is a bearer credential like any other, which is the reason for
 * the short life: whoever holds it can download the responses, no session
 * required. That is the point — the user opens it in a browser that may not be
 * signed in — and it is why nothing here is longer-lived than a click.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

/** Fifteen minutes: a human clicking a link an assistant just produced. */
const TTL_MS = 15 * 60 * 1000

export type ExportGrant = {
  formId: string
  workspaceId: string
  userId: string
  /** The key that minted this, or null for a browser session. */
  apiKeyId: string | null
  expiresAt: number
}

function signingKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set")
  return Buffer.from(raw, "base64")
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url")
}

/** Mint a handle for one form, valid for {@link TTL_MS}. */
export function mintExportToken(grant: Omit<ExportGrant, "expiresAt">, now = Date.now()): string {
  const payload = base64url(JSON.stringify({ ...grant, expiresAt: now + TTL_MS }))
  return `${payload}.${sign(payload)}`
}

/**
 * Verify a handle. Returns the grant, or null for anything wrong at all —
 * bad signature, expired, malformed. The caller cannot tell which, and does not
 * need to: every case means "no download".
 */
export function verifyExportToken(token: string, now = Date.now()): ExportGrant | null {
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null

  const payload = token.slice(0, dot)
  const provided = Buffer.from(token.slice(dot + 1), "base64url")
  const expected = Buffer.from(sign(payload), "base64url")

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a wrong-length MAC is a forgery either way.
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  let grant: ExportGrant
  try {
    grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }

  // Signature verified, so the fields are ours — but the clock still decides.
  if (typeof grant.expiresAt !== "number" || grant.expiresAt <= now) return null
  if (!grant.formId || !grant.workspaceId || !grant.userId) return null

  return grant
}

export { TTL_MS as EXPORT_TOKEN_TTL_MS }
