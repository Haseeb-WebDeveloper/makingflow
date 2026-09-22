import "server-only"

import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  workspaceConnections,
  type SheetShareError,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import { decrypt, encrypt } from "@/lib/integrations/crypto"
import {
  TAG_COLUMN,
  TAG_ROW,
  type Cell,
  type MetadataTag,
} from "@/lib/integrations/sheet-layout"

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
const DRIVE_API = "https://www.googleapis.com/drive/v3/files"

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
    throw new Error("Connection has no refresh token, reconnect required")
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
  await appendRows(accessToken, spreadsheetId, sheetName, [values])
}

/** Append many rows in one call (used to backfill existing submissions). */
export async function appendRows(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return
  const range = `${sheetName}!A1`
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
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

/**
 * Grid-addressed Sheets I/O.
 *
 * Everything below targets a tab by its numeric `sheetId` and cells by 0-based
 * index — never by an A1 range like `Submissions!A1`. That is deliberate: the
 * A1 form embeds the tab's NAME, so renaming the tab used to break every write,
 * and `values.append`'s table detection put rows above the header whenever row
 * 1 happened to be blank. Indexes have neither failure mode.
 */

/** Run a batchUpdate (structural edits, metadata, grid writes). */
export async function runBatchUpdate(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<void> {
  await batchUpdate(accessToken, spreadsheetId, requests)
}

/** A CellData that writes `value`, or an empty one that leaves the cell alone. */
export function cellData(value: Cell): Record<string, unknown> {
  return value === null ? {} : { userEnteredValue: { stringValue: value } }
}

function metadataRequest(
  sheetId: number,
  dimension: "ROWS" | "COLUMNS",
  index: number,
  key: string,
  value: string,
): unknown {
  return {
    createDeveloperMetadata: {
      developerMetadata: {
        metadataKey: key,
        metadataValue: value,
        // DOCUMENT rather than PROJECT: it survives a Google Cloud project
        // change, which PROJECT visibility would silently hide from us.
        visibility: "DOCUMENT",
        location: {
          dimensionRange: { sheetId, dimension, startIndex: index, endIndex: index + 1 },
        },
      },
    },
  }
}

export function tagColumnRequest(sheetId: number, index: number, value: string): unknown {
  return metadataRequest(sheetId, "COLUMNS", index, TAG_COLUMN, value)
}

export function tagRowRequest(sheetId: number, index: number, value: string): unknown {
  return metadataRequest(sheetId, "ROWS", index, TAG_ROW, value)
}

/** Write one cell, leaving every other cell in the row untouched. */
export function writeCellRequest(
  sheetId: number,
  rowIndex: number,
  columnIndex: number,
  value: string,
): unknown {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex },
      fields: "userEnteredValue",
      rows: [{ values: [cellData(value)] }],
    },
  }
}

/** Every MakingFlow tag on the spreadsheet, with its CURRENT index. */
export async function searchDeveloperMetadata(
  accessToken: string,
  spreadsheetId: string,
  keys: readonly string[],
): Promise<MetadataTag[]> {
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/developerMetadata:search`,
    {
      method: "POST",
      body: JSON.stringify({
        dataFilters: keys.map((metadataKey) => ({ developerMetadataLookup: { metadataKey } })),
      }),
    },
  )) as {
    matchedDeveloperMetadata?: {
      developerMetadata?: {
        metadataKey?: string
        metadataValue?: string
        location?: {
          dimensionRange?: { sheetId?: number; dimension?: string; startIndex?: number }
        }
      }
    }[]
  }

  const tags: MetadataTag[] = []
  for (const match of data.matchedDeveloperMetadata ?? []) {
    const meta = match.developerMetadata
    const range = meta?.location?.dimensionRange
    if (!meta?.metadataKey || meta.metadataValue === undefined) continue
    // Sheet- or spreadsheet-scoped metadata has no dimensionRange. Defaulting
    // its index to 0 would claim column A for whatever it tagged.
    if (!range || range.sheetId === undefined || range.startIndex === undefined) continue
    if (range.dimension !== "ROWS" && range.dimension !== "COLUMNS") continue
    tags.push({
      key: meta.metadataKey,
      value: meta.metadataValue,
      dimension: range.dimension,
      index: range.startIndex,
      sheetId: range.sheetId,
    })
  }
  return tags
}

/**
 * Append one row after the last row with data IN THE SHEET.
 *
 * `appendCells` is what `values.append` is not: it has no table detection, so a
 * blank row above the header cannot pull the write to the top. It is also a
 * single atomic server-side operation, which matters because deliveries are not
 * serialized per form — two responses to the same form can land at once.
 */
export async function appendCells(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  cells: Cell[],
): Promise<void> {
  if (cells.length === 0) return
  await batchUpdate(accessToken, spreadsheetId, [
    {
      appendCells: {
        sheetId,
        fields: "userEnteredValue",
        rows: [{ values: cells.map(cellData) }],
      },
    },
  ])
}

/** Append many rows in one atomic call (used to backfill existing submissions). */
export async function appendCellRows(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  rows: Cell[][],
): Promise<void> {
  if (rows.length === 0) return
  await batchUpdate(accessToken, spreadsheetId, [
    {
      appendCells: {
        sheetId,
        fields: "userEnteredValue",
        rows: rows.map((cells) => ({ values: cells.map(cellData) })),
      },
    },
  ])
}

/** Read one column top-to-bottom (incl. the header) by index, not by name. */
export async function readGridColumn(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  columnIndex: number,
): Promise<string[]> {
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values:batchGetByDataFilter`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "COLUMNS",
        dataFilters: [
          { gridRange: { sheetId, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 } },
        ],
      }),
    },
  )) as { valueRanges?: { valueRange?: { values?: string[][] } }[] }
  return data.valueRanges?.[0]?.valueRange?.values?.[0] ?? []
}

/** Read the top `rowCount` rows by index — how a displaced header is found. */
export async function readGridRows(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  rowCount: number,
): Promise<string[][]> {
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values:batchGetByDataFilter`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        dataFilters: [{ gridRange: { sheetId, startRowIndex: 0, endRowIndex: rowCount } }],
      }),
    },
  )) as { valueRanges?: { valueRange?: { values?: string[][] } }[] }
  return data.valueRanges?.[0]?.valueRange?.values ?? []
}

/**
 * A Drive sharing call that failed, classified.
 *
 * The classification is the point. "403" tells the person reading the
 * integrations card nothing they can act on, while "your Google Workspace
 * refuses to share outside the domain" tells them why their teammate is missing
 * AND that no retry will help.
 */
export class DriveShareError extends Error {
  constructor(
    readonly kind: SheetShareError,
    message: string,
  ) {
    super(message)
    this.name = "DriveShareError"
  }
}

/** Classify a Drive error body. Google names the policy case in the message. */
function classifyDriveError(status: number, body: string): SheetShareError {
  if (status === 403 && /domain|sharing/i.test(body)) return "domain_policy"
  if (status === 400) return "not_a_google_account"
  return "failed"
}

/**
 * Drive's half of the client, separate from `sheetsFetch` for one reason: every
 * call here must carry `supportsAllDrives=true`. A file in a Google Workspace
 * shared drive is invisible to the Drive API without it — a flat 404 — while the
 * Sheets API reads the same file happily. That asymmetry has already cost one
 * debugging session; it should not cost another.
 */
async function driveFetch(accessToken: string, url: string, init: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new DriveShareError(
      classifyDriveError(res.status, body),
      `Drive API ${res.status}: ${body}`,
    )
  }
  return res
}

/**
 * Give one person access to one file. Allowed under `drive.file` for files this
 * app created — verified against a live connection, which reports
 * `capabilities.canShare: true` on our spreadsheets.
 *
 * No notification email: this runs once per member per form, so a workspace
 * turning sharing on would otherwise mail everybody once per spreadsheet.
 */
export async function shareFile(
  accessToken: string,
  fileId: string,
  email: string,
  role: "reader" | "writer",
): Promise<{ permissionId: string }> {
  const url = `${DRIVE_API}/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`
  const res = await driveFetch(accessToken, url, {
    method: "POST",
    body: JSON.stringify({ type: "user", role, emailAddress: email }),
  })
  const data = (await res.json()) as { id: string }
  return { permissionId: data.id }
}

/**
 * Withdraw a grant we created. A 404 means someone removed it in Drive before we
 * got here, which is the state we were asking for — not an error.
 */
export async function unshareFile(
  accessToken: string,
  fileId: string,
  permissionId: string,
): Promise<void> {
  const url = `${DRIVE_API}/${fileId}/permissions/${permissionId}?supportsAllDrives=true`
  try {
    await driveFetch(accessToken, url, { method: "DELETE" })
  } catch (err) {
    if (err instanceof DriveShareError && /Drive API 404/.test(err.message)) return
    throw err
  }
}
