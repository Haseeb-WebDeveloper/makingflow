import "server-only"

/**
 * Client registration, and the redirect-URI matching that protects it.
 *
 * Registration is UNAUTHENTICATED, by design (RFC 7591). ChatGPT and claude.ai
 * discover a server and register on the spot; there is no human to pre-arrange
 * credentials with. That sounds alarming until you notice what a registration
 * actually buys: an id, and permission to ask a user for consent. It grants no
 * access whatsoever. Access comes from a person ticking boxes on our consent
 * screen, and is recorded in `mcp_oauth_grants`.
 *
 * So the thing to defend here is not the table — it is the REDIRECT.
 *
 * An authorization code travels back to the client through the browser, in a
 * URL. Whoever receives that URL can attempt to redeem the code. If we let a
 * client register `https://evil.test/steal` and later accept a redirect to it
 * for a code issued to somebody else, we have built a code-stealing service. So:
 *
 *   - redirect URIs are matched as EXACT STRINGS, never by prefix, never by
 *     wildcard, never by "starts with the registered origin". Prefix matching is
 *     the single most common way authorization servers get this wrong:
 *     `https://good.test/cb` also prefixes `https://good.test/cb.evil.test`.
 *   - only `https` is allowed, with one carve-out for loopback (below).
 *   - no fragments, ever — a fragment is not sent to the server and cannot be
 *     matched, so accepting one means accepting something we never checked.
 *
 * THE LOOPBACK CARVE-OUT. A desktop client like Claude Code listens on an
 * ephemeral port it cannot know in advance, so RFC 8252 §7.3 says a server MUST
 * ignore the port when matching `http://127.0.0.1` and `http://localhost`. That
 * is safe for the same reason it is necessary: loopback never leaves the user's
 * own machine. It is scoped tightly here — host must be exactly a loopback
 * literal, and only the port is allowed to differ.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpOauthClients } from "@/lib/db/schema"

/** Registered clients cannot pile up unbounded per request; a sane ceiling. */
const MAX_REDIRECT_URIS = 20

export type OauthClient = {
  id: string
  clientName: string | null
  clientUri: string | null
  redirectUris: string[]
}

export type RegistrationInput = {
  clientName?: unknown
  clientUri?: unknown
  redirectUris?: unknown
}

export type RegistrationResult =
  | { ok: true; client: OauthClient }
  | { ok: false; error: string; description: string }

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"])

/**
 * Is this a loopback redirect, whose port we must ignore?
 *
 * Note `localhost` is included because clients use it, but it is worth being
 * clear-eyed: `localhost` resolves through the OS and is not guaranteed to be
 * loopback the way a literal address is. It is accepted because RFC 8252 names
 * it and real clients depend on it, not because it is equally safe.
 */
function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
}

/** A redirect URI we are willing to store. */
function validateRedirectUri(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  // A fragment never reaches the server, so it can be neither matched nor
  // honoured — accepting one would mean storing something we cannot check.
  if (url.hash) return null

  if (isLoopback(url)) return raw
  if (url.protocol !== "https:") return null
  // Nothing is gained by allowing credentials in a redirect, and they are a
  // known way to make a URL read as one host while resolving to another.
  if (url.username || url.password) return null

  return raw
}

/**
 * Does `candidate` match one of the client's registered redirect URIs?
 *
 * Exact string equality, except that loopback URIs compare with the port
 * ignored — and even then every other component must match exactly.
 */
export function redirectUriMatches(registered: readonly string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true

  let want: URL
  try {
    want = new URL(candidate)
  } catch {
    return false
  }
  if (!isLoopback(want) || want.hash) return false

  return registered.some((entry) => {
    let have: URL
    try {
      have = new URL(entry)
    } catch {
      return false
    }
    return (
      isLoopback(have) &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
      // Port deliberately not compared — that is the entire carve-out.
    )
  })
}

/** Register a client. Returns the stored row, which includes its new id. */
export async function registerClient(input: RegistrationInput): Promise<RegistrationResult> {
  const raw = Array.isArray(input.redirectUris) ? input.redirectUris : null
  if (!raw || raw.length === 0) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "redirect_uris is required and must list at least one URI.",
    }
  }
  if (raw.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: `At most ${MAX_REDIRECT_URIS} redirect URIs.`,
    }
  }

  const redirectUris: string[] = []
  for (const entry of raw) {
    if (typeof entry !== "string") {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        description: "Every redirect URI must be a string.",
      }
    }
    const valid = validateRedirectUri(entry)
    if (!valid) {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        description: `${entry} is not an acceptable redirect URI. Use https, or http on loopback, with no fragment.`,
      }
    }
    redirectUris.push(valid)
  }

  // Display text written by whoever is registering. Bounded so it cannot
  // deform the consent screen, and never trusted as an identity.
  const clientName =
    typeof input.clientName === "string" ? input.clientName.trim().slice(0, 120) || null : null
  const clientUri =
    typeof input.clientUri === "string" ? input.clientUri.trim().slice(0, 500) || null : null

  const [row] = await db
    .insert(mcpOauthClients)
    .values({ clientName, clientUri, redirectUris })
    .returning({
      id: mcpOauthClients.id,
      clientName: mcpOauthClients.clientName,
      clientUri: mcpOauthClients.clientUri,
      redirectUris: mcpOauthClients.redirectUris,
    })

  return { ok: true, client: row }
}

/** Look a client up by id. Returns null for anything that is not a known id. */
export async function findClient(clientId: string): Promise<OauthClient | null> {
  // The id is a uuid from a query string; a malformed one must be "not found"
  // rather than a database error surfacing as a 500.
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return null

  const [row] = await db
    .select({
      id: mcpOauthClients.id,
      clientName: mcpOauthClients.clientName,
      clientUri: mcpOauthClients.clientUri,
      redirectUris: mcpOauthClients.redirectUris,
    })
    .from(mcpOauthClients)
    .where(eq(mcpOauthClients.id, clientId))
    .limit(1)
  return row ?? null
}

/** A client plus the redirect it asked for, validated together. */
export async function resolveClientRedirect(
  clientId: string | null,
  redirectUri: string | null,
): Promise<{ ok: true; client: OauthClient; redirectUri: string } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "client_id is required." }
  const client = await findClient(clientId)
  if (!client) return { ok: false, error: "Unknown client." }

  // With exactly one registered URI the parameter is optional, per OAuth 2.1.
  const candidate = redirectUri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null)
  if (!candidate) {
    return { ok: false, error: "redirect_uri is required for this client." }
  }
  if (!redirectUriMatches(client.redirectUris, candidate)) {
    return { ok: false, error: "redirect_uri does not match a registered URI." }
  }

  return { ok: true, client, redirectUri: candidate }
}

/** Clients a user has consented to, for admin views. Cheap and rarely used. */
export async function clientById(id: string) {
  return db
    .select()
    .from(mcpOauthClients)
    .where(and(eq(mcpOauthClients.id, id)))
    .limit(1)
}
