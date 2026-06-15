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

type SearchResult = { results: { id: string; object: string }[] }

/** First page the integration can access (the consent-granted parent), or null. */
export async function findAccessiblePage(token: string): Promise<string | null> {
  const data = await notionFetch<SearchResult>(token, "/search", {
    method: "POST",
    body: { filter: { value: "page", property: "object" }, page_size: 10 },
  })
  const page = data.results.find((r) => r.object === "page")
  return page?.id ?? null
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
