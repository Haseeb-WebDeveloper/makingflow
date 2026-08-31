import "server-only"

import { parseTallyBlocks, parseTallySettings, type TallyBlock } from "@/lib/import/tally-blocks"
import type { EditorForm, EditorSettings } from "@/lib/builder/form-model"
import {
  TALLY_ERROR_MESSAGES,
  TallyImportError,
} from "@/lib/import/tally-error"

/**
 * Reading a Tally form from its public page.
 *
 * Tally's respondent app is a Next.js Pages Router site, so every public form
 * ships its own definition inside `__NEXT_DATA__` — the same block array the
 * API returns from `GET /forms/{id}/blocks`. That is the whole trick: no
 * account, no API key, no OAuth. The user pastes the link they already share
 * with respondents.
 *
 * The fragility is stated plainly because it is real: if Tally moves this app to
 * the App Router, `__NEXT_DATA__` becomes streamed `self.__next_f` chunks and
 * this stops working. It fails loudly (NO_DEFINITION) rather than importing an
 * empty form, and the API-key path — same parser, different fetcher — is the
 * answer if that day comes (./tally-api.ts).
 */

/** Hosts we will fetch. */
const TALLY_HOSTS = new Set(["tally.so", "www.tally.so"])

/** Enough for a very large form; a cap the response cannot talk us out of. */
const MAX_BYTES = 5_000_000
const TIMEOUT_MS = 15_000

/**
 * Normalise anything a user might paste into a canonical public form URL.
 *
 * Accepts the share link, the embed link, and a bare form id. Locked to Tally's
 * own hosts: this fetches a URL the user supplies from our server, so an open
 * host list would make it an SSRF gadget pointed at our own network. Forms on a
 * custom domain are the cost of that, and are the API path's job.
 */
export function parseTallyUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  // A bare form id — Tally's are short alphanumerics.
  if (/^[A-Za-z0-9_-]{4,32}$/.test(raw)) return `https://tally.so/r/${raw}`

  let url: URL
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!TALLY_HOSTS.has(url.hostname.toLowerCase())) return null

  const match = url.pathname.match(/^\/(?:r|embed)\/([A-Za-z0-9_-]{4,32})\/?$/)
  if (!match) return null
  return `https://tally.so/r/${match[1]}`
}

/** Pull the JSON payload Next.js embeds for hydration. */
export function extractNextData(html: string): unknown {
  const match = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export type TallyForm = {
  title: string
  blocks: TallyBlock[]
  settings: EditorSettings
  passwordProtected: boolean
}

/** Read the parts of `pageProps` we care about, tolerating anything missing. */
export function readTallyPageProps(data: unknown): TallyForm | null {
  const pageProps = (data as { props?: { pageProps?: Record<string, unknown> } })?.props?.pageProps
  if (!pageProps || !Array.isArray(pageProps.blocks)) return null
  const settings = pageProps.settings as Record<string, unknown> | undefined
  return {
    title: typeof pageProps.name === "string" ? pageProps.name : "",
    blocks: pageProps.blocks as TallyBlock[],
    settings: parseTallySettings(settings),
    passwordProtected: settings?.isPasswordProtected === true,
  }
}

/**
 * Fetch a public Tally form and parse it into an editable form.
 *
 * Throws {@link TallyImportError} with a code the caller maps to a message —
 * every failure here is something the user can act on, so none of them should
 * surface as a generic error.
 */
export async function importTallyFormFromUrl(input: string): Promise<{
  form: EditorForm
  skipped: { type: string; label: string }[]
  sourceUrl: string
}> {
  const url = parseTallyUrl(input)
  if (!url) throw new TallyImportError("INVALID_URL", TALLY_ERROR_MESSAGES.INVALID_URL)

  let res: Response
  try {
    res = await fetch(url, {
      // Tally serves the definition to anyone; no cookies, no credentials.
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "text/html" },
    })
  } catch {
    throw new TallyImportError("UNREACHABLE", TALLY_ERROR_MESSAGES.UNREACHABLE)
  }

  if (res.status === 404) throw new TallyImportError("NOT_FOUND", TALLY_ERROR_MESSAGES.NOT_FOUND)
  if (!res.ok) throw new TallyImportError("UNREACHABLE", TALLY_ERROR_MESSAGES.UNREACHABLE)

  // Redirecting off Tally would mean parsing a page we never vetted.
  if (!TALLY_HOSTS.has(new URL(res.url).hostname.toLowerCase())) {
    throw new TallyImportError("NOT_FOUND", TALLY_ERROR_MESSAGES.NOT_FOUND)
  }

  const html = await readCapped(res)
  const page = readTallyPageProps(extractNextData(html))
  if (!page) throw new TallyImportError("NO_DEFINITION", TALLY_ERROR_MESSAGES.NO_DEFINITION)
  if (page.passwordProtected) {
    throw new TallyImportError("PASSWORD_PROTECTED", TALLY_ERROR_MESSAGES.PASSWORD_PROTECTED)
  }

  const { form, skipped } = parseTallyBlocks(page.blocks, page.title)
  return {
    form: { ...form, settings: page.settings },
    skipped,
    sourceUrl: url,
  }
}

/**
 * Read a response body, refusing to buffer more than {@link MAX_BYTES}.
 *
 * Decoded as it streams rather than concatenated first: `{ stream: true }` is
 * what keeps a multi-byte character split across two chunks from becoming a
 * replacement character — and Tally forms are full of emoji.
 */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()
  const decoder = new TextDecoder()
  let html = ""
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new TallyImportError("NO_DEFINITION", TALLY_ERROR_MESSAGES.NO_DEFINITION)
    }
    html += decoder.decode(value, { stream: true })
  }
  return html + decoder.decode()
}
