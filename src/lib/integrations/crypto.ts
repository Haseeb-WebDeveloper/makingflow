import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

/**
 * App-layer encryption for secrets at rest (OAuth access/refresh tokens). The
 * schema requires integration tokens to be encrypted before they touch the DB
 * — Supabase-at-rest encryption isn't enough for third-party grants that could
 * be exfiltrated via a SQL-level leak.
 *
 * Algorithm: AES-256-GCM. Wire format (base64): iv(12) ‖ authTag(16) ‖ cipher.
 * Key: APP_ENCRYPTION_KEY, a base64-encoded 32-byte key (generate with
 * `openssl rand -base64 32`).
 */

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set")
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 raw bytes)")
  }
  cachedKey = buf
  return buf
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64")
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}

/**
 * Sign/verify a short-lived OAuth `state` blob (HMAC-SHA256, base64url). The
 * state carries the workspace/form/return-path across the Google round-trip;
 * signing it makes the callback tamper-proof without a server-side store.
 */
export function signState(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", key()).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifyState<T>(token: string, maxAgeMs = 10 * 60 * 1000): T | null {
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", key()).update(body).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      t?: number
    } & T
    if (typeof payload.t === "number" && Date.now() - payload.t > maxAgeMs) return null
    return payload as T
  } catch {
    return null
  }
}
