import "server-only"

/**
 * Notion OAuth + a thin REST client. Mirrors `google.ts` but simpler: Notion
 * access tokens don't expire and there's no refresh flow. The token is stored
 * encrypted (see crypto.ts) and decrypted only at call time by the caller.
 *
 * Env: NOTION_CLIENT_ID + NOTION_CLIENT_SECRET (a public integration registered
 * at notion.so/my-integrations, with the redirect URL pointing at our callback).
 */

const API = "https://api.notion.com/v1"
const AUTH_URL = `${API}/oauth/authorize`
const TOKEN_URL = `${API}/oauth/token`
export const NOTION_VERSION = "2022-06-28"

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000"
}

export function redirectUri(): string {
  return `${siteUrl()}/api/integrations/notion/callback`
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.NOTION_CLIENT_ID
  const secret = process.env.NOTION_CLIENT_SECRET
  if (!id || !secret) throw new Error("NOTION_CLIENT_ID / NOTION_CLIENT_SECRET not set")
  return { id, secret }
}

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET)
}

/** Build the Notion consent-screen URL. */
export function buildConsentUrl(state: string): string {
  const { id } = clientCreds()
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: "code",
    owner: "user",
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  workspace_id?: string
  workspace_name?: string
  bot_id?: string
}

/** Exchange the one-time auth code for a (non-expiring) bot token. */
export async function exchangeCode(code: string): Promise<{
  accessToken: string
  workspaceName: string | null
  notionWorkspaceId: string | null
  botId: string | null
}> {
  const { id, secret } = clientCreds()
  const basic = Buffer.from(`${id}:${secret}`).toString("base64")
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  })
  if (!res.ok) throw new Error(`Notion token exchange failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as TokenResponse
  return {
    accessToken: data.access_token,
    workspaceName: data.workspace_name ?? null,
    notionWorkspaceId: data.workspace_id ?? null,
    botId: data.bot_id ?? null,
  }
}

// ── REST client (operates on a decrypted token) ─────────────────────────────

async function notionFetch<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) throw new Error(`Notion ${path} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

export type SearchPage = {
  id: string
  object: string
  archived?: boolean
  in_trash?: boolean
  parent?: { type?: string }
  properties?: Record<string, { type?: string; title?: { plain_text?: string }[] }>
}
type SearchResult = { results: SearchPage[] }

export type CandidatePage = { id: string; title: string; topLevel: boolean }

/** A page's title, from whichever property holds it ("title" for page parents). */
function pageTitle(page: SearchPage): string {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop?.type === "title" || prop?.title) {
      return (prop.title ?? []).map((t) => t.plain_text ?? "").join("").trim()
    }
  }
  return ""
}

/**
 * Not every page Notion returns from /search can be a parent.
 *
 * Rows of a database have `parent.type === 'database_id'`, and some of them —
 * Person profiles in the built-in People database, most notably — reject child
 * content outright with "Person profile with ID … cannot have content". Search
 * returns those first often enough that blindly taking `results[0]` fails on a
 * perfectly healthy workspace. Regular pages are better parents anyway, so skip
 * database rows entirely, along with anything archived or in the trash.
 */
function canHostContent(page: SearchPage): boolean {
  if (page.object !== "page") return false
  if (page.archived || page.in_trash) return false
  return page.parent?.type !== "database_id"
}

/**
 * Pages the integration can access AND write child content to, best candidate
 * first: top-level pages before nested ones. Empty when the user granted the
 * integration access to nothing usable.
 */
export function selectParentCandidates(results: SearchPage[]): CandidatePage[] {
  return results
    .filter(canHostContent)
    .map((p) => ({ id: p.id, title: pageTitle(p), topLevel: p.parent?.type === "workspace" }))
    .sort((a, b) => Number(b.topLevel) - Number(a.topLevel))
}

export async function listCandidateParentPages(token: string): Promise<CandidatePage[]> {
  const data = await notionFetch<SearchResult>(token, "/search", {
    method: "POST",
    // 10 was easily filled by unusable rows before any real page appeared: a
    // real workspace returned 22 database rows among its first 26 results.
    body: { filter: { value: "page", property: "object" }, page_size: 100 },
  })
  return selectParentCandidates(data.results)
}

/** Create a child page under a parent page. Returns its id + url. */
export async function createPage(
  token: string,
  parentPageId: string,
  title: string,
): Promise<{ id: string; url?: string }> {
  return notionFetch(token, "/pages", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      properties: { title: [{ type: "text", text: { content: title } }] },
    },
  })
}

/** Create a page (row) inside a database with already-typed properties. */
export async function createDatabasePage(
  token: string,
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<{ id: string; url?: string }> {
  return notionFetch(token, "/pages", {
    method: "POST",
    body: { parent: { type: "database_id", database_id: databaseId }, properties },
  })
}

/** Create a database under a parent page with the given property schema. */
export async function createDatabase(
  token: string,
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>,
): Promise<{ id: string; url?: string }> {
  return notionFetch(token, "/databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties,
    },
  })
}

/** Add/patch properties on an existing database (for newly added form fields). */
export async function updateDatabaseProperties(
  token: string,
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await notionFetch(token, `/databases/${databaseId}`, {
    method: "PATCH",
    body: { properties },
  })
}

/** Archive (soft-delete) a page. */
export async function archivePage(token: string, pageId: string): Promise<void> {
  await notionFetch(token, `/pages/${pageId}`, {
    method: "PATCH",
    body: { archived: true },
  })
}

/** Find a page in a database by its title property value (returns page id). */
export async function queryDatabaseByTitle(
  token: string,
  databaseId: string,
  titleProp: string,
  value: string,
): Promise<string | null> {
  const data = await notionFetch<SearchResult>(token, `/databases/${databaseId}/query`, {
    method: "POST",
    body: { filter: { property: titleProp, title: { equals: value } }, page_size: 1 },
  })
  return data.results[0]?.id ?? null
}
