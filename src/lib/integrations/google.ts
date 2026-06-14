import "server-only"

import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaceConnections, type WorkspaceConnection } from "@/lib/db/schema"
import { decrypt, encrypt } from "@/lib/integrations/crypto"

/**
 * Google OAuth + Sheets/Drive API, scoped to the `drive.file` grant. With this
 * scope the app can ONLY create spreadsheets and read/write the ones it made —
 * it can never see the rest of the user's Drive. `openid email` is added only
 * to label the connection with the account's email.
 *
 * All token I/O goes through here; tokens are stored encrypted (see crypto.ts)
 * and refreshed lazily in `getValidAccessToken`.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
]

export const DEFAULT_SHEET_NAME = "Submissions"

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000"
}

export function redirectUri(): string {
  return `${siteUrl()}/api/integrations/google/callback`
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set")
  return { id, secret }
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

/** Build the consent-screen URL. `offline` + `consent` guarantee a refresh token. */
export function buildConsentUrl(state: string): string {
  const { id } = clientCreds()
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  id_token?: string
}

/** Pull the account email out of the OpenID id_token (Google-signed, over TLS). */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split(".")[1]
    const json = Buffer.from(payload, "base64url").toString("utf8")
    const claims = JSON.parse(json) as { email?: string }
    return claims.email ?? null
  } catch {
    return null
  }
}

/** Exchange the one-time auth code for tokens. */
export async function exchangeCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string[]
  email: string | null
}> {
  const { id, secret } = clientCreds()
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as TokenResponse
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: data.scope ? data.scope.split(" ") : [],
    email: emailFromIdToken(data.id_token),
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: Date
}> {
  const { id, secret } = clientCreds()
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as TokenResponse
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

/**
 * Return a usable access token for a connection, refreshing + re-persisting it
 * if it's expired (or within a 60s skew). Throws if the connection has no
 * refresh token and its access token is stale (user must reconnect).
 */
export async function getValidAccessToken(conn: WorkspaceConnection): Promise<string> {
  const stillValid = conn.expiresAt && conn.expiresAt.getTime() - Date.now() > 60_000
  if (stillValid) return decrypt(conn.accessToken)

  if (!conn.refreshToken) {
    throw new Error("Connection has no refresh token — reconnect required")
  }
  const refreshed = await refreshAccessToken(decrypt(conn.refreshToken))
  await db
    .update(workspaceConnections)
    .set({
      accessToken: encrypt(refreshed.accessToken),
      expiresAt: refreshed.expiresAt,
    })
    .where(eq(workspaceConnections.id, conn.id))
  return refreshed.accessToken
}

async function sheetsFetch(accessToken: string, url: string, init: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Create a spreadsheet with a single named tab. Allowed under `drive.file`. */
export async function createSpreadsheet(
  accessToken: string,
  title: string,
  sheetName = DEFAULT_SHEET_NAME,
): Promise<{ spreadsheetId: string; spreadsheetUrl: string; sheetId: number | null }> {
  const data = (await sheetsFetch(accessToken, SHEETS_API, {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: sheetName } }],
    }),
  })) as {
    spreadsheetId: string
    spreadsheetUrl: string
    sheets?: { properties?: { sheetId?: number } }[]
  }
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
    sheetId: data.sheets?.[0]?.properties?.sheetId ?? null,
  }
}

/** Look up a tab's inner id (gid) by its title — needed for row deletion. */
export async function getSheetId(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
): Promise<number | null> {
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}?fields=${encodeURIComponent("sheets.properties(sheetId,title)")}`,
    { method: "GET" },
  )) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] }
  const match =
    data.sheets?.find((s) => s.properties?.title === sheetName) ?? data.sheets?.[0]
  return match?.properties?.sheetId ?? null
}

/** Overwrite the header row (row 1) with the given column labels. */
export async function setHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
): Promise<void> {
  const range = `${sheetName}!A1`
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [headers] }) },
  )
}

/** Append one row of values after the last filled row. */
export async function appendRow(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  values: string[],
): Promise<void> {
  const range = `${sheetName}!A1`
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [values] }) },
  )
}

/** Read a single column top-to-bottom (incl. the header) as a flat string array. */
export async function getColumnValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  column: string,
): Promise<string[]> {
  const range = `${sheetName}!${column}:${column}`
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=COLUMNS`,
    { method: "GET" },
  )) as { values?: string[][] }
  return data.values?.[0] ?? []
}

/** Run a batchUpdate (structural edits like insert column / delete row). */
async function batchUpdate(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<void> {
  if (requests.length === 0) return
  await sheetsFetch(accessToken, `${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  })
}

/** Insert `count` blank column(s) at `startIndex` (0-based), shifting data right. */
export async function insertColumns(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  startIndex: number,
  count = 1,
): Promise<void> {
  await batchUpdate(accessToken, spreadsheetId, [
    {
      insertDimension: {
        range: { sheetId, dimension: "COLUMNS", startIndex, endIndex: startIndex + count },
        inheritFromBefore: false,
      },
    },
  ])
}

/** Delete a single row by 0-based index (row 1 / the header = index 0). */
export async function deleteRow(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  rowIndex: number,
): Promise<void> {
  await batchUpdate(accessToken, spreadsheetId, [
    {
      deleteDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
      },
    },
  ])
}
