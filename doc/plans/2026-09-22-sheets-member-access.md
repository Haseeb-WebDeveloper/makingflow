# Member Access to Response Spreadsheets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One owner-only setting on the `/integrations` Google Sheets card that gives workspace members access to every form's response spreadsheet, and keeps that access correct as people and forms come and go.

**Architecture:** The setting lives on the workspace's Google connection (`workspace_connections.metadata.google.share`); the grants live on each destination (`form_integrations.config.shares`), each carrying the Drive permission id we created it with. A reconciler diffs desired members against recorded grants and calls Drive, never touching a permission it has no recorded id for. Both stores are jsonb, so there is no migration.

**Tech Stack:** Next.js 16 (server actions, `after()`), Drizzle ORM, Postgres, Google Drive API v3 (`drive.file` scope, already granted), Vitest (unit + integration against a real Postgres on :54322), Tailwind + shadcn/ui.

**Spec:** `doc/specs/2026-09-22-sheets-member-access-design.md`

## Global Constraints

- Drive API calls MUST include `supportsAllDrives=true`. Verified: a Figmenta spreadsheet lives in a Shared Drive and `files.get` returns `404 File not found` without it while the Sheets API succeeds.
- Sharing calls MUST pass `sendNotificationEmail=false`.
- Scope stays exactly `["openid", "email", "https://www.googleapis.com/auth/drive.file"]` in `src/lib/integrations/google.ts`. Do not add a scope; the feature is designed to need none. Adding one forces every connected workspace to re-consent.
- Never delete a Drive permission unless our stored `shares` entry for that email carries a `permissionId`. A hand-made share must survive reconciliation.
- Never fall back to link-based sharing (`type: "anyone"`). Not as an option, not as a rescue for a blocked grant.
- Sharing must never fail a delivery or block provisioning: the reconciler catches everything and records it. This is the AGENTS.md degrade-gracefully rule.
- Default role in the UI is `reader` ("Viewer").
- Server Actions live in `src/lib/actions/`, never inlined in components (AGENTS.md).
- `params`/`searchParams` are Promises; `cacheComponents: true` means `"use cache"`, never `unstable_cache`.
- Every query is scoped to the caller's workspace. No cross-tenant reads.
- Run the test DB with `pnpm test:db:up` before integration tests.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/db/schema.ts` (modify) | `ConnectionMetadata.google.share` + `GoogleSheetsIntegrationConfig.shares` types |
| `src/lib/auth/roles.ts` (modify) | new owner-only `manage_integrations` action |
| `src/lib/integrations/google.ts` (modify) | `driveFetch`, `shareFile`, `unshareFile`, `DriveShareError` |
| `src/lib/integrations/sheets-sharing.ts` (create) | desired-set + diff (pure), and the reconciler that applies it |
| `src/lib/core/integrations.ts` (modify) | `setSheetSharing`, `reconcileSheetSharing` (owner-gated), reconcile after provisioning |
| `src/lib/actions/integrations.ts` (modify) | thin server actions over both |
| `src/lib/integrations/sync.ts` (modify) | reconcile after a sheet is created or re-provisioned |
| `src/lib/core/team.ts` (modify) | reconcile after `removeMember` |
| `src/lib/data/team.ts` (modify) | reconcile after `acceptInvitationByToken` |
| `src/lib/data/integrations.ts` (modify) | expose the setting + per-member roll-up to the page |
| `src/components/integrations/workspace-integrations.tsx` (modify) | the control, in the Sheets details panel |
| `tests/unit/sheet-share-diff.test.ts` (create) | pure diff behaviour |
| `tests/integration/sheets-sharing.test.ts` (create) | reconciler against the real DB, Drive stubbed |

Task order is dependency order: types → Drive layer → pure diff → reconciler → triggers → actions/permissions → read path → UI.

---

### Task 1: Types for the setting and the grants

**Files:**
- Modify: `src/lib/db/schema.ts` (`GoogleSheetsIntegrationConfig` ~line 316, `ConnectionMetadata` ~line 362)

**Interfaces:**
- Consumes: nothing.
- Produces: `SheetShare`, `SheetShareError`, `SheetSharingSetting`; `GoogleSheetsIntegrationConfig.shares?: SheetShare[]`; `ConnectionMetadata.google?: { share?: SheetSharingSetting }`.

- [ ] **Step 1: Add the types**

In `src/lib/db/schema.ts`, directly above `export type GoogleSheetsIntegrationConfig`:

```ts
/** Why a share attempt failed, in terms the card can explain to a human. */
export type SheetShareError = 'domain_policy' | 'not_a_google_account' | 'failed'

/**
 * One person's access to one spreadsheet, as WE know it.
 *
 * `permissionId` is load-bearing: it is the only thing that distinguishes a
 * grant we created from a share the account's owner made by hand in Drive, and
 * therefore the only thing that makes revoking safe. An entry without one is a
 * record of a failed attempt, never something to delete.
 */
export type SheetShare = {
  email: string
  role: 'reader' | 'writer'
  permissionId?: string
  error?: SheetShareError
  syncedAt?: string
}

/**
 * Who gets access to the spreadsheets this connection owns. Absent = off, so
 * every existing connection reads as off with no backfill.
 */
export type SheetSharingSetting = {
  role: 'reader' | 'writer'
  audience: 'all' | { emails: string[] }
}
```

Inside `GoogleSheetsIntegrationConfig`, after the `columns` field:

```ts
  // Access we have granted on this spreadsheet, one entry per person. See
  // SheetShare — an entry with no permissionId is a failed attempt, not a grant.
  shares?: SheetShare[]
```

In `ConnectionMetadata`, extend the doc comment and add the key:

```ts
export type ConnectionMetadata = {
  notion?: { parentPageId?: string; workspaceId?: string; botId?: string }
  // Google: whether the spreadsheets this account owns are shared with the
  // workspace's members, and as what. Lives on the connection because the
  // account owns the files — disconnect it and the setting is meaningless.
  google?: { share?: SheetSharingSetting }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (types only; nothing consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(sheets): types for spreadsheet sharing settings and grants"
```

---

### Task 2: Drive share/unshare in the Google client

**Files:**
- Modify: `src/lib/integrations/google.ts` (add `DRIVE_API` beside `SHEETS_API` ~line 20; add the functions after `deleteRow`)
- Test: `tests/unit/drive-share.test.ts` (create)

**Interfaces:**
- Consumes: `SheetShareError` (Task 1).
- Produces:
  - `export class DriveShareError extends Error { readonly kind: SheetShareError }`
  - `export async function shareFile(accessToken: string, fileId: string, email: string, role: 'reader' | 'writer'): Promise<{ permissionId: string }>`
  - `export async function unshareFile(accessToken: string, fileId: string, permissionId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/drive-share.test.ts`:

```ts
/**
 * The Drive sharing calls, and the two things about them that are easy to get
 * wrong and invisible when you do: the shared-drive flag, and turning Google's
 * status codes into something the UI can explain.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { DriveShareError, shareFile, unshareFile } from "@/lib/integrations/google"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
function err(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe("shareFile", () => {
  test("grants the role to the email and returns the permission id", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "perm-1" }))

    const res = await shareFile("token", "file-1", "a@b.com", "reader")

    expect(res).toEqual({ permissionId: "perm-1" })
    const [url, init] = fetchMock.mock.calls[0]
    // Without supportsAllDrives a file in a shared drive 404s — the failure
    // mode this assertion exists to prevent.
    expect(url).toContain("supportsAllDrives=true")
    expect(url).toContain("sendNotificationEmail=false")
    expect(JSON.parse(init.body)).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "a@b.com",
    })
  })

  test("a domain policy refusal is reported as such, not as a generic failure", async () => {
    fetchMock.mockReturnValueOnce(
      err(403, {
        error: {
          code: 403,
          message: "The domain administrators have disabled Drive apps sharing outside of the domain.",
        },
      }),
    )

    await expect(shareFile("token", "file-1", "a@gmail.com", "reader")).rejects.toMatchObject({
      kind: "domain_policy",
    })
  })

  test("an address Google won't accept is reported as not a Google account", async () => {
    fetchMock.mockReturnValueOnce(
      err(400, { error: { code: 400, message: "Invalid sharing request" } }),
    )

    await expect(shareFile("token", "file-1", "nope@nowhere.test", "reader")).rejects.toMatchObject({
      kind: "not_a_google_account",
    })
  })

  test("anything else is a plain failure", async () => {
    fetchMock.mockReturnValueOnce(err(500, { error: { code: 500, message: "backend error" } }))

    await expect(shareFile("token", "file-1", "a@b.com", "reader")).rejects.toMatchObject({
      kind: "failed",
    })
  })
})

describe("unshareFile", () => {
  test("removes the permission", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response("", { status: 204 })))

    await unshareFile("token", "file-1", "perm-1")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/files/file-1/permissions/perm-1")
    expect(url).toContain("supportsAllDrives=true")
    expect(init.method).toBe("DELETE")
  })

  test("a permission that is already gone is the outcome we wanted", async () => {
    fetchMock.mockReturnValueOnce(err(404, { error: { code: 404, message: "not found" } }))

    await expect(unshareFile("token", "file-1", "perm-1")).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=unit tests/unit/drive-share.test.ts`
Expected: FAIL — `shareFile`/`unshareFile`/`DriveShareError` are not exported from `@/lib/integrations/google`.

- [ ] **Step 3: Implement**

In `src/lib/integrations/google.ts`, beside `SHEETS_API`:

```ts
const DRIVE_API = "https://www.googleapis.com/drive/v3/files"
```

Add `import type { SheetShareError } from "@/lib/db/schema"` to the existing type import from `@/lib/db/schema`, and append at the end of the file:

```ts
/**
 * A Drive sharing call that failed, classified.
 *
 * The classification is the point: "403" tells the person reading the
 * integrations card nothing, while "your Google Workspace refuses to share
 * outside the domain" tells them why their teammate is missing and that no
 * retry will help.
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

/** Classify a Drive error body. Google states the policy case in the message. */
function classifyDriveError(status: number, body: string): SheetShareError {
  if (status === 403 && /domain|sharing/i.test(body)) return "domain_policy"
  if (status === 400) return "not_a_google_account"
  return "failed"
}

/**
 * Drive's half of the client. Separate from `sheetsFetch` because every call
 * here needs `supportsAllDrives=true` — a file in a Google Workspace shared
 * drive is invisible to the Drive API without it (404), while the Sheets API
 * reads it happily. That asymmetry has already cost one debugging session.
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
    throw new DriveShareError(classifyDriveError(res.status, body), `Drive API ${res.status}: ${body}`)
  }
  return res
}

/**
 * Give one person access to one file. Allowed under `drive.file` for files this
 * app created — verified against a live connection, which reports
 * `capabilities.canShare: true` on our spreadsheets.
 *
 * No notification email: this runs once per member per form, and a workspace
 * connecting Sheets would otherwise mail everyone a dozen times.
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
 * Withdraw a grant we created. A 404 means someone removed it in Drive first,
 * which is the state we were asking for — not an error.
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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest --run --project=unit tests/unit/drive-share.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/google.ts tests/unit/drive-share.test.ts
git commit -m "feat(sheets): Drive share/unshare, with shared-drive support and classified failures"
```

---

### Task 3: The pure diff — who should have access, and what changes

**Files:**
- Create: `src/lib/integrations/sheets-sharing.ts`
- Test: `tests/unit/sheet-share-diff.test.ts` (create)

**Interfaces:**
- Consumes: `SheetShare`, `SheetSharingSetting` (Task 1).
- Produces:
  - `export function desiredShareEmails(setting: SheetSharingSetting | undefined, memberEmails: string[], ownerEmail: string): string[]`
  - `export function planShareChanges(desired: string[], role: 'reader' | 'writer', current: SheetShare[]): { grant: string[]; revoke: SheetShare[]; keep: SheetShare[] }` — `revoke` only ever contains entries with a `permissionId`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sheet-share-diff.test.ts`:

```ts
/**
 * Who should be able to open a form's spreadsheet, and what has to change to
 * make that true. Pure functions, because this is the part that decides whether
 * someone's access is withdrawn — it should be readable without a database.
 */

import { describe, expect, test } from "vitest"
import { desiredShareEmails, planShareChanges } from "@/lib/integrations/sheets-sharing"

describe("desiredShareEmails", () => {
  const members = ["owner@acme.com", "a@acme.com", "b@gmail.com"]

  test("nobody when sharing is off", () => {
    expect(desiredShareEmails(undefined, members, "owner@acme.com")).toEqual([])
  })

  test("every member except the account that owns the files", () => {
    // Drive rejects sharing a file with its own owner, and that rejection would
    // read as a real failure on the card.
    expect(
      desiredShareEmails({ role: "reader", audience: "all" }, members, "owner@acme.com"),
    ).toEqual(["a@acme.com", "b@gmail.com"])
  })

  test("only the chosen members when the audience is a list", () => {
    expect(
      desiredShareEmails(
        { role: "reader", audience: { emails: ["b@gmail.com"] } },
        members,
        "owner@acme.com",
      ),
    ).toEqual(["b@gmail.com"])
  })

  test("a chosen email that is no longer a member is dropped", () => {
    expect(
      desiredShareEmails(
        { role: "reader", audience: { emails: ["gone@acme.com"] } },
        members,
        "owner@acme.com",
      ),
    ).toEqual([])
  })

  test("addresses are compared case-insensitively", () => {
    expect(
      desiredShareEmails({ role: "reader", audience: "all" }, ["A@Acme.com"], "a@acme.com"),
    ).toEqual([])
  })
})

describe("planShareChanges", () => {
  const granted = (email: string, role: "reader" | "writer" = "reader"): SheetShareLike => ({
    email,
    role,
    permissionId: `perm-${email}`,
  })
  type SheetShareLike = { email: string; role: "reader" | "writer"; permissionId?: string; error?: "failed" }

  test("grants access nobody has yet", () => {
    const plan = planShareChanges(["a@acme.com"], "reader", [])
    expect(plan.grant).toEqual(["a@acme.com"])
    expect(plan.revoke).toEqual([])
  })

  test("leaves an existing grant alone", () => {
    const plan = planShareChanges(["a@acme.com"], "reader", [granted("a@acme.com")])
    expect(plan.grant).toEqual([])
    expect(plan.revoke).toEqual([])
    expect(plan.keep.map((s) => s.email)).toEqual(["a@acme.com"])
  })

  test("revokes a grant for someone no longer entitled to it", () => {
    const plan = planShareChanges([], "reader", [granted("a@acme.com")])
    expect(plan.revoke.map((s) => s.permissionId)).toEqual(["perm-a@acme.com"])
  })

  test("a role change is a revoke plus a grant", () => {
    const plan = planShareChanges(["a@acme.com"], "writer", [granted("a@acme.com", "reader")])
    expect(plan.revoke.map((s) => s.email)).toEqual(["a@acme.com"])
    expect(plan.grant).toEqual(["a@acme.com"])
  })

  test("never revokes an entry with no permission id", () => {
    // Someone shared this by hand in Drive, or a previous attempt failed. Either
    // way it is not ours to remove.
    const plan = planShareChanges([], "reader", [{ email: "a@acme.com", role: "reader" }])
    expect(plan.revoke).toEqual([])
  })

  test("retries an address whose last attempt failed", () => {
    const plan = planShareChanges(["a@acme.com"], "reader", [
      { email: "a@acme.com", role: "reader", error: "failed" },
    ])
    expect(plan.grant).toEqual(["a@acme.com"])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=unit tests/unit/sheet-share-diff.test.ts`
Expected: FAIL — cannot resolve `@/lib/integrations/sheets-sharing`.

- [ ] **Step 3: Implement**

Create `src/lib/integrations/sheets-sharing.ts`:

```ts
import "server-only"

import type { SheetShare, SheetSharingSetting } from "@/lib/db/schema"

/** Case-insensitive, whitespace-free comparison key for an address. */
const key = (email: string) => email.trim().toLowerCase()

/**
 * Who should be able to open the spreadsheets this connection owns.
 *
 * The account's own address is always excluded: Drive refuses to share a file
 * with its owner, and recording that refusal would put a permanent "blocked" row
 * on the card for the one person who already has access.
 */
export function desiredShareEmails(
  setting: SheetSharingSetting | undefined,
  memberEmails: string[],
  ownerEmail: string,
): string[] {
  if (!setting) return []
  const owner = key(ownerEmail)
  const chosen =
    setting.audience === "all" ? null : new Set(setting.audience.emails.map(key))
  const seen = new Set<string>()
  const out: string[] = []
  for (const email of memberEmails) {
    const k = key(email)
    if (k === owner || seen.has(k)) continue
    if (chosen && !chosen.has(k)) continue
    seen.add(k)
    out.push(email)
  }
  return out
}

/**
 * What has to change on one spreadsheet to match the desired audience.
 *
 * THE RULE: `revoke` only ever contains entries that carry a `permissionId` we
 * recorded. An entry without one is either a failed attempt or a share the
 * account's owner made by hand in Drive, and removing someone's manual share to
 * tidy our own bookkeeping is a worse bug than leaving a stale grant.
 *
 * A role change is expressed as a revoke plus a grant rather than a patch: one
 * code path to test, and the recorded id stays truthful at every step.
 */
export function planShareChanges(
  desired: string[],
  role: "reader" | "writer",
  current: SheetShare[],
): { grant: string[]; revoke: SheetShare[]; keep: SheetShare[] } {
  const wanted = new Map(desired.map((e) => [key(e), e]))
  const grant: string[] = []
  const revoke: SheetShare[] = []
  const keep: SheetShare[] = []

  for (const share of current) {
    const k = key(share.email)
    const stillWanted = wanted.has(k)
    const correctRole = share.role === role
    const isOurs = Boolean(share.permissionId)

    if (stillWanted && correctRole && isOurs) {
      keep.push(share)
      wanted.delete(k)
      continue
    }
    if (isOurs) revoke.push(share)
    // A failed attempt (no permissionId) is simply re-attempted below.
  }

  for (const email of wanted.values()) grant.push(email)
  return { grant, revoke, keep }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest --run --project=unit tests/unit/sheet-share-diff.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sheets-sharing.ts tests/unit/sheet-share-diff.test.ts
git commit -m "feat(sheets): decide who should have spreadsheet access, and what to change"
```

---

### Task 4: The reconciler — apply the plan to one sheet and to a workspace

**Files:**
- Modify: `src/lib/integrations/sheets-sharing.ts`
- Test: `tests/integration/sheets-sharing.test.ts` (create)

**Interfaces:**
- Consumes: `desiredShareEmails`, `planShareChanges` (Task 3); `shareFile`, `unshareFile`, `DriveShareError`, `getValidAccessToken` (Task 2 + existing).
- Produces:
  - `export async function reconcileSheetShares(conn: WorkspaceConnection, row: { id: string; formId: string; config: GoogleSheetsIntegrationConfig }): Promise<void>`
  - `export async function reconcileWorkspaceSheetShares(workspaceId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/sheets-sharing.test.ts`:

```ts
/**
 * Sharing the response spreadsheets with the workspace's members.
 *
 * The behaviour worth pinning is not "it calls Drive" — it is what we do with
 * what Drive says: a grant is recorded with the id that makes it revocable, a
 * refusal is recorded against the person it concerns without taking the others
 * down with it, and a share we did not create is never removed.
 *
 * Drive is stubbed. The database is real.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"

const shareCalls: { fileId: string; email: string; role: string }[] = []
const unshareCalls: { fileId: string; permissionId: string }[] = []
/** email -> the failure Drive should raise for it */
const refuse = new Map<string, "domain_policy" | "not_a_google_account" | "failed">()

vi.mock("@/lib/integrations/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/google")>()
  return {
    ...actual,
    getValidAccessToken: async () => "test-token",
    shareFile: async (_t: string, fileId: string, email: string, role: string) => {
      const kind = refuse.get(email)
      if (kind) throw new actual.DriveShareError(kind, `stubbed ${kind}`)
      shareCalls.push({ fileId, email, role })
      return { permissionId: `perm-${email}` }
    },
    unshareFile: async (_t: string, fileId: string, permissionId: string) => {
      unshareCalls.push({ fileId, permissionId })
    },
  }
})

const { db } = await import("@/lib/db")
const { formIntegrations, forms, users, workspaces, workspaceConnections, workspaceMembers } =
  await import("@/lib/db/schema")
const { reconcileSheetShares, reconcileWorkspaceSheetShares } = await import(
  "@/lib/integrations/sheets-sharing"
)
import type { GoogleSheetsIntegrationConfig, SheetShare, SheetSharingSetting } from "@/lib/db/schema"

let seq = 0

/** A workspace with a connected Google account, three members, and one form's sheet. */
async function seed(opts: {
  share?: SheetSharingSetting
  shares?: SheetShare[]
}): Promise<{ workspaceId: string; formId: string; rowId: string; connId: string }> {
  seq += 1
  const unique = `share-${seq}-${Date.now()}`
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS ${unique}`, slug: `ws-${unique}` })
    .returning({ id: workspaces.id })

  for (const email of [`owner-${unique}@acme.test`, `a-${unique}@acme.test`, `b-${unique}@acme.test`]) {
    const [u] = await db
      .insert(users)
      .values({ id: randomUUID(), email, name: email })
      .returning({ id: users.id })
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role: "member" })
  }

  const [conn] = await db
    .insert(workspaceConnections)
    .values({
      workspaceId: ws.id,
      provider: "google",
      accountEmail: `owner-${unique}@acme.test`,
      accessToken: "encrypted-placeholder",
      metadata: opts.share ? { google: { share: opts.share } } : null,
    })
    .returning({ id: workspaceConnections.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Job Application",
      status: "published",
      publicId: `shr${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  const [row] = await db
    .insert(formIntegrations)
    .values({
      formId: form.id,
      workspaceId: ws.id,
      type: "google_sheets",
      enabled: true,
      config: {
        connectionId: conn.id,
        spreadsheetId: "sheet-1",
        sheetName: "Submissions",
        hasIdColumn: true,
        columns: [],
        shares: opts.shares,
      } satisfies GoogleSheetsIntegrationConfig,
    })
    .returning({ id: formIntegrations.id })

  return { workspaceId: ws.id, formId: form.id, rowId: row.id, connId: conn.id }
}

async function sharesOf(rowId: string): Promise<SheetShare[]> {
  const [row] = await db
    .select({ config: formIntegrations.config })
    .from(formIntegrations)
    .where(eq(formIntegrations.id, rowId))
    .limit(1)
  return (row.config as GoogleSheetsIntegrationConfig).shares ?? []
}

async function conn(workspaceId: string) {
  const [c] = await db
    .select()
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.workspaceId, workspaceId),
        eq(workspaceConnections.provider, "google"),
      ),
    )
    .limit(1)
  return c
}

async function rowFor(formId: string) {
  const [r] = await db
    .select({ id: formIntegrations.id, formId: formIntegrations.formId, config: formIntegrations.config })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)
  return r as { id: string; formId: string; config: GoogleSheetsIntegrationConfig }
}

beforeEach(() => {
  shareCalls.length = 0
  unshareCalls.length = 0
  refuse.clear()
})

describe("reconcileSheetShares", () => {
  test("does nothing at all when sharing is off", async () => {
    const s = await seed({})

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(shareCalls).toEqual([])
    expect(await sharesOf(s.rowId)).toEqual([])
  })

  test("grants every member but the account owner, recording the permission id", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(shareCalls.map((c) => c.role)).toEqual(["reader", "reader"])
    const shares = await sharesOf(s.rowId)
    expect(shares).toHaveLength(2)
    expect(shares.every((sh) => sh.permissionId?.startsWith("perm-"))).toBe(true)
    expect(shares.some((sh) => sh.email.startsWith("owner-"))).toBe(false)
  })

  test("a refusal is recorded against that person and nobody else suffers", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    const members = await sharesOfMembers(s.workspaceId)
    refuse.set(members[0], "domain_policy")

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    const shares = await sharesOf(s.rowId)
    const blocked = shares.find((sh) => sh.email === members[0])
    expect(blocked?.error).toBe("domain_policy")
    expect(blocked?.permissionId).toBeUndefined()
    expect(shares.filter((sh) => sh.permissionId).length).toBe(1)
  })

  test("reconciling twice makes no further Drive calls", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    shareCalls.length = 0

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(shareCalls).toEqual([])
    expect(unshareCalls).toEqual([])
  })

  test("turning sharing off withdraws the grants we made", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    await db
      .update(workspaceConnections)
      .set({ metadata: null })
      .where(eq(workspaceConnections.id, s.connId))

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(unshareCalls).toHaveLength(2)
    expect(await sharesOf(s.rowId)).toEqual([])
  })

  test("a share we did not create is never withdrawn", async () => {
    // No permissionId: either a failed attempt of ours, or a share the account's
    // owner made by hand in Drive. Not ours to remove.
    const s = await seed({ shares: [{ email: "outsider@acme.test", role: "reader" }] })

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(unshareCalls).toEqual([])
  })

  test("raising the role re-grants it", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    await db
      .update(workspaceConnections)
      .set({ metadata: { google: { share: { role: "writer", audience: "all" } } } })
      .where(eq(workspaceConnections.id, s.connId))
    shareCalls.length = 0

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(unshareCalls).toHaveLength(2)
    expect(shareCalls.map((c) => c.role)).toEqual(["writer", "writer"])
    expect((await sharesOf(s.rowId)).every((sh) => sh.role === "writer")).toBe(true)
  })

  test("a sheet with no spreadsheet yet is skipped", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    const row = await rowFor(s.formId)
    await db
      .update(formIntegrations)
      .set({ config: { ...row.config, spreadsheetId: "" } })
      .where(eq(formIntegrations.id, s.rowId))

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(shareCalls).toEqual([])
  })
})

describe("reconcileWorkspaceSheetShares", () => {
  test("covers every sheet in the workspace and never throws", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })

    await expect(reconcileWorkspaceSheetShares(s.workspaceId)).resolves.toBeUndefined()

    expect((await sharesOf(s.rowId)).filter((sh) => sh.permissionId)).toHaveLength(2)
  })
})

/** The two member addresses that are not the connected account. */
async function sharesOfMembers(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
  const c = await conn(workspaceId)
  return rows.map((r) => r.email).filter((e) => e !== c.accountEmail)
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:db:up && npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts`
Expected: FAIL — `reconcileSheetShares` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/integrations/sheets-sharing.ts` (and extend its imports):

```ts
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  forms,
  formIntegrations,
  users,
  workspaceConnections,
  workspaceMembers,
  type GoogleSheetsIntegrationConfig,
  type WorkspaceConnection,
} from "@/lib/db/schema"
import {
  DriveShareError,
  getValidAccessToken,
  shareFile,
  unshareFile,
} from "@/lib/integrations/google"

/** How many sheets one workspace-wide reconcile touches. Google rate-limits. */
const MAX_RECONCILE_SHEETS = 25

/** The workspace's member addresses, in a stable order. */
async function memberEmails(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(users.email)
  return rows.map((r) => r.email)
}

/**
 * Make one spreadsheet's access match the workspace's setting.
 *
 * Best-effort by design: every Drive failure is recorded against the person it
 * concerns and the rest of the work continues. Sharing sits on top of delivery —
 * a Drive outage must not cost anybody a response, and must never stop a sheet
 * from being provisioned.
 *
 * The write is guarded on the config still naming this connection, so a
 * concurrent account switch (which replaces the spreadsheet entirely) wins
 * instead of having grants for a dead file written back over it.
 */
export async function reconcileSheetShares(
  conn: WorkspaceConnection,
  row: { id: string; formId: string; config: GoogleSheetsIntegrationConfig },
): Promise<void> {
  try {
    const config = row.config
    if (!config.spreadsheetId) return // nothing provisioned yet — nothing to share

    const setting = conn.metadata?.google?.share
    const current = config.shares ?? []
    const desired = desiredShareEmails(
      setting,
      await memberEmails(conn.workspaceId),
      conn.accountEmail,
    )
    const { grant, revoke, keep } = planShareChanges(desired, setting?.role ?? "reader", current)
    if (!grant.length && !revoke.length) return

    const accessToken = await getValidAccessToken(conn)
    const next: SheetShare[] = [...keep]

    for (const share of revoke) {
      try {
        await unshareFile(accessToken, config.spreadsheetId, share.permissionId!)
      } catch (err) {
        // Keep the record: a grant we failed to withdraw still exists, and
        // forgetting its id would strand it forever.
        next.push({ ...share, error: err instanceof DriveShareError ? err.kind : "failed" })
      }
    }

    const role = setting?.role ?? "reader"
    for (const email of grant) {
      try {
        const { permissionId } = await shareFile(accessToken, config.spreadsheetId, email, role)
        next.push({ email, role, permissionId, syncedAt: new Date().toISOString() })
      } catch (err) {
        next.push({ email, role, error: err instanceof DriveShareError ? err.kind : "failed" })
      }
    }

    await db
      .update(formIntegrations)
      .set({ config: { ...config, shares: next } })
      .where(
        and(
          eq(formIntegrations.id, row.id),
          sql`${formIntegrations.config} ->> 'connectionId' = ${config.connectionId}`,
        ),
      )
  } catch (err) {
    console.error("[sharing] reconcile failed", err)
  }
}

/**
 * Bring every sheet in a workspace in line — the setting changed, or the
 * membership did. Serial and capped for the same reason `ensureWorkspaceSheets`
 * is: each sheet costs one Drive call per person, and Google rate-limits.
 */
export async function reconcileWorkspaceSheetShares(workspaceId: string): Promise<void> {
  try {
    const [conn] = await db
      .select()
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, workspaceId),
          eq(workspaceConnections.provider, "google"),
        ),
      )
      .limit(1)
    if (!conn) return

    const rows = await db
      .select({
        id: formIntegrations.id,
        formId: formIntegrations.formId,
        config: formIntegrations.config,
      })
      .from(formIntegrations)
      .innerJoin(forms, eq(forms.id, formIntegrations.formId))
      .where(
        and(
          eq(formIntegrations.workspaceId, workspaceId),
          eq(formIntegrations.type, "google_sheets"),
          isNull(forms.deletedAt),
        ),
      )
      .orderBy(desc(formIntegrations.updatedAt))
      .limit(MAX_RECONCILE_SHEETS)

    for (const row of rows) {
      await reconcileSheetShares(conn, {
        id: row.id,
        formId: row.formId,
        config: row.config as GoogleSheetsIntegrationConfig,
      })
    }
    if (rows.length === MAX_RECONCILE_SHEETS) {
      console.warn(
        `[sharing] reconciled the ${MAX_RECONCILE_SHEETS} most recent sheets for workspace ${workspaceId}; older ones are covered on their next change`,
      )
    }
  } catch (err) {
    console.error("[sharing] workspace reconcile failed", err)
  }
}
```

Add `type SheetShare` to the type import at the top of the file.

- [ ] **Step 4: Run the test**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sheets-sharing.ts tests/integration/sheets-sharing.test.ts
git commit -m "feat(sheets): reconcile spreadsheet access against the workspace's members"
```

---

### Task 5: Reconcile whenever a spreadsheet is created or replaced

**Files:**
- Modify: `src/lib/integrations/sync.ts` (`reprovisionOrphanedSheet` ~line 71, `ensureFormSheet` ~line 265, the lazy-create branch of `syncSubmissionToSheets`)
- Modify: `src/lib/core/integrations.ts` (`enableFormSheet` ~line 85-125)
- Test: `tests/integration/sheets-sharing.test.ts` (extend)

**Interfaces:**
- Consumes: `reconcileSheetShares` (Task 4).
- Produces: no new exports; a new spreadsheet always ends up shared according to the setting.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/sheets-sharing.test.ts`:

```ts
describe("a newly created spreadsheet", () => {
  test("is shared as soon as it exists", async () => {
    // The file is new, so it carries none of the old file's permissions — the
    // case that makes "share on creation" a requirement rather than an
    // optimisation.
    const { ensureFormSheet } = await import("@/lib/integrations/sync")
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await db.delete(formIntegrations).where(eq(formIntegrations.id, s.rowId))

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Job Application" })

    const row = await rowFor(s.formId)
    expect((row.config.shares ?? []).filter((sh) => sh.permissionId)).toHaveLength(2)
  })
})
```

Also append the account-switch case, which is the reason this trigger exists at all:

```ts
describe("a spreadsheet replaced after an account switch", () => {
  test("is shared with the members again", async () => {
    // The replacement file is a NEW file: it carries none of the old one's
    // permissions. Without re-sharing, switching the workspace's Google account
    // silently locks the whole team out of their responses.
    const { ensureFormSheet } = await import("@/lib/integrations/sync")
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    const before = await rowFor(s.formId)
    // Point the config at a grant that no longer exists — what a disconnect +
    // reconnect leaves behind.
    await db
      .update(formIntegrations)
      .set({ config: { ...before.config, connectionId: randomUUID() } })
      .where(eq(formIntegrations.id, s.rowId))
    shareCalls.length = 0

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Job Application" })

    const after = await rowFor(s.formId)
    expect(after.config.spreadsheetId).toBe("new-sheet-1")
    expect(shareCalls.every((c) => c.fileId === "new-sheet-1")).toBe(true)
    expect((after.config.shares ?? []).filter((sh) => sh.permissionId)).toHaveLength(2)
  })
})
```

This needs the Sheets half of the Google client stubbed too, so extend the `vi.mock` factory at the top of the file with the stubs `sheets-account-switch.test.ts` uses:

```ts
    createSpreadsheet: async () => ({
      spreadsheetId: "new-sheet-1",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-1/edit",
      sheetId: 1,
    }),
    setHeaderRow: async () => {},
    getSheetId: async () => 0,
    insertColumns: async () => {},
    appendRow: async () => {},
    appendRows: async () => {},
    getColumnValues: async () => [] as string[],
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts`
Expected: FAIL — `shares` is empty; nothing reconciles after provisioning.

- [ ] **Step 3: Implement**

In `src/lib/integrations/sync.ts`, import the reconciler:

```ts
import { reconcileSheetShares } from "@/lib/integrations/sheets-sharing"
```

At the end of `reprovisionOrphanedSheet`, after the backfill:

```ts
  // The replacement file starts with no permissions of its own, so the sharing
  // setting has to be applied again or an account switch silently locks the
  // team out.
  await reconcileSheetShares(conn, { id: rowId, formId: form.id, config })
```

In `ensureFormSheet`, after the `backfillFormSheet(conn, config, form.id)` call in the freshly-claimed branch:

```ts
    await reconcileSheetShares(conn, { id: claimed.id, formId: form.id, config })
```

In `syncSubmissionToSheets`, in the branch that just claimed a new row (immediately before its `return { ok: true }`):

```ts
        await reconcileSheetShares(conn, { id: claimed.id, formId: form.id, config: created })
```

In `src/lib/core/integrations.ts`, inside `enableFormSheet`'s existing `after()` block, after the backfill:

```ts
    const [row] = await db
      .select({ id: formIntegrations.id })
      .from(formIntegrations)
      .where(
        and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")),
      )
      .limit(1)
    if (row) await reconcileSheetShares(conn, { id: row.id, formId, config })
```

with `import { reconcileSheetShares } from "@/lib/integrations/sheets-sharing"` added.

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts tests/integration/sheets-account-switch.test.ts`
Expected: PASS — the new test plus all 8 account-switch tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sync.ts src/lib/core/integrations.ts tests/integration/sheets-sharing.test.ts
git commit -m "feat(sheets): share a spreadsheet as soon as it is created or replaced"
```

---

### Task 6: Reconcile when the membership changes

**Files:**
- Modify: `src/lib/core/team.ts` (`removeMember` ~line 189-214)
- Modify: `src/lib/data/team.ts` (`acceptInvitationByToken` ~line 128-157)
- Test: `tests/integration/sheets-sharing.test.ts` (extend)

**Interfaces:**
- Consumes: `reconcileWorkspaceSheetShares` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/sheets-sharing.test.ts`:

```ts
describe("membership changes", () => {
  test("removing a member withdraws their access", async () => {
    // Leaving the workspace has to mean leaving the data. Otherwise "remove
    // member" is a lie nobody notices until it matters.
    //
    // This drives removeMember itself rather than the reconciler, because the
    // trigger IS the behaviour under test — and note that integration tests stub
    // after() to a no-op, so a deferred reconcile would be invisible here and in
    // any other test that ever checks this.
    const teamCore = await import("@/lib/core/team")
    const { testContext } = await import("../helpers/context")

    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    const members = await db
      .select({ userId: workspaceMembers.userId, email: users.email })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, s.workspaceId))
      .orderBy(users.email)
    // An owner has to do the removing, and it cannot be the person removed.
    const actor = members[0]
    const victim = members[1]
    await db
      .update(workspaceMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(workspaceMembers.workspaceId, s.workspaceId),
          eq(workspaceMembers.userId, actor.userId),
        ),
      )
    const ctx = testContext({ userId: actor.userId, workspaceId: s.workspaceId, role: "owner" })

    const res = await teamCore.removeMember(ctx, victim.userId)

    expect(res).toEqual({ success: true })
    expect(unshareCalls).toHaveLength(1)
    expect((await sharesOf(s.rowId)).some((sh) => sh.email === victim.email)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts`
Expected: FAIL — `unshareCalls` is empty. Removal deletes the membership row and leaves the Drive grant in place.

- [ ] **Step 3: Wire the triggers**

In `src/lib/core/team.ts`, import the reconciler and call it after the delete in `removeMember`, before `invalidate`:

```ts
import { reconcileWorkspaceSheetShares } from "@/lib/integrations/sheets-sharing"
```

```ts
  // Their Drive access goes with their membership. AWAITED, not deferred: this
  // is a withdrawal of access, so it should be done before we report success —
  // and after() would also make it untestable, since the integration setup stubs
  // after() to a no-op. The reconciler never throws, so this cannot fail the
  // removal.
  await reconcileWorkspaceSheetShares(ctx.workspaceId)
```

In `src/lib/data/team.ts`, after the transaction in `acceptInvitationByToken` and before its `return { ok: true, workspaceId: invite.workspaceId }`:

```ts
  // A new member should not have to ask anyone for access to the spreadsheets.
  // Awaited for the same reason as above, and because this also runs from signup,
  // which has no request scope to defer into.
  await reconcileWorkspaceSheetShares(invite.workspaceId)
```

with `import { reconcileWorkspaceSheetShares } from "@/lib/integrations/sheets-sharing"`.

- [ ] **Step 4: Run the suites that touch team code**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts tests/integration/team-core.test.ts`
Expected: PASS for both. `team-core` has no Google connection in its fixtures, so the reconciler returns immediately there.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/team.ts src/lib/data/team.ts tests/integration/sheets-sharing.test.ts
git commit -m "feat(sheets): follow membership changes with spreadsheet access"
```

---

### Task 7: The owner-only actions

**Files:**
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/core/integrations.ts`
- Modify: `src/lib/actions/integrations.ts`
- Test: `tests/integration/integrations-core.test.ts` (extend)

**Interfaces:**
- Consumes: `reconcileWorkspaceSheetShares` (Task 4), `authorize` from `@/lib/auth/context`.
- Produces:
  - `roles.ts`: `WorkspaceAction` includes `"manage_integrations"`.
  - core: `setSheetSharing(ctx: AuthContext, share: SheetSharingSetting | null): Promise<Result>`, `reconcileSheetSharing(ctx: AuthContext): Promise<Result>`.
  - actions: same two names, taking `(share)` / `()` and returning `Result`.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/integrations-core.test.ts`:

```ts
describe("spreadsheet sharing is an owner's decision", () => {
  test("a member cannot change it", async () => {
    const t = await seedTenant("share-gate")
    await db.insert(workspaceConnections).values({
      workspaceId: t.workspaceId,
      provider: "google",
      accountEmail: "owner@example.test",
      accessToken: "encrypted-placeholder",
    })
    const ctx = testContext({ userId: t.userId, workspaceId: t.workspaceId, role: "member" })

    const res = await integrationsCore.setSheetSharing(ctx, { role: "reader", audience: "all" })

    expect(res).toEqual({ success: false, error: "Only owners can do that" })
  })

  test("an owner's setting is stored on the connection", async () => {
    const t = await seedTenant("share-set")
    await db.insert(workspaceConnections).values({
      workspaceId: t.workspaceId,
      provider: "google",
      accountEmail: "owner@example.test",
      accessToken: "encrypted-placeholder",
    })
    const ctx = testContext({ userId: t.userId, workspaceId: t.workspaceId, role: "owner" })

    const res = await integrationsCore.setSheetSharing(ctx, { role: "writer", audience: "all" })

    expect(res).toEqual({ success: true })
    const [conn] = await db
      .select({ metadata: workspaceConnections.metadata })
      .from(workspaceConnections)
      .where(eq(workspaceConnections.workspaceId, t.workspaceId))
      .limit(1)
    expect(conn.metadata?.google?.share).toEqual({ role: "writer", audience: "all" })
  })

  test("turning it off clears the setting without disturbing Notion's metadata", async () => {
    const t = await seedTenant("share-off")
    await db.insert(workspaceConnections).values({
      workspaceId: t.workspaceId,
      provider: "google",
      accountEmail: "owner@example.test",
      accessToken: "encrypted-placeholder",
      metadata: {
        notion: { parentPageId: "page-1" },
        google: { share: { role: "reader", audience: "all" } },
      },
    })
    const ctx = testContext({ userId: t.userId, workspaceId: t.workspaceId, role: "owner" })

    await integrationsCore.setSheetSharing(ctx, null)

    const [conn] = await db
      .select({ metadata: workspaceConnections.metadata })
      .from(workspaceConnections)
      .where(eq(workspaceConnections.workspaceId, t.workspaceId))
      .limit(1)
    expect(conn.metadata?.google?.share).toBeUndefined()
    expect(conn.metadata?.notion?.parentPageId).toBe("page-1")
  })

  test("there is nothing to set when Google is not connected", async () => {
    const t = await seedTenant("share-unconnected")
    const ctx = testContext({ userId: t.userId, workspaceId: t.workspaceId, role: "owner" })

    const res = await integrationsCore.setSheetSharing(ctx, { role: "reader", audience: "all" })

    expect(res).toEqual({ success: false, error: "Connect a Google account first" })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=integration tests/integration/integrations-core.test.ts`
Expected: FAIL — `integrationsCore.setSheetSharing` is not a function.

- [ ] **Step 3: Implement**

In `src/lib/auth/roles.ts`:

```ts
export type WorkspaceAction =
  | "manage_team"
  | "delete_workspace"
  | "update_workspace"
  | "manage_integrations"
```

```ts
export const OWNER_ONLY: Record<WorkspaceAction, true> = {
  manage_team: true,
  delete_workspace: true,
  // Name, slug, and logo — the workspace's identity to everyone in it.
  update_workspace: true,
  // Handing the whole workspace access to one person's Google account is an
  // administrative decision. Note that CONNECTING an account deliberately is
  // not gated: any member may wire up their own sync.
  manage_integrations: true,
}
```

In `src/lib/core/integrations.ts`, add to the imports:

```ts
import { authorize } from "@/lib/auth/context"
import { reconcileWorkspaceSheetShares } from "@/lib/integrations/sheets-sharing"
import type { SheetSharingSetting } from "@/lib/db/schema"
```

and the two functions, after `disconnectGoogle`:

```ts
/**
 * Set (or clear) who in the workspace gets access to the spreadsheets the
 * connected Google account owns, then make the existing sheets match.
 *
 * Owner-only: this hands other people access to one person's Drive.
 */
export async function setSheetSharing(
  ctx: AuthContext,
  share: SheetSharingSetting | null,
): Promise<Result> {
  const denied = authorize(ctx, {
    scopes: ["integrations:write"],
    action: "manage_integrations",
  })
  if (denied) return { success: false, error: denied }

  const conn = await workspaceGoogleConnection(ctx)
  if (!conn) return { success: false, error: "Connect a Google account first" }

  // Merge, never replace: Notion's parent page lives in the same column.
  const metadata = { ...(conn.metadata ?? {}), google: { ...(conn.metadata?.google ?? {}) } }
  if (share) metadata.google.share = share
  else delete metadata.google.share

  await db
    .update(workspaceConnections)
    .set({ metadata })
    .where(eq(workspaceConnections.id, conn.id))

  // Applying it to the sheets that already exist is the whole point of the
  // setting, and it is too slow to hold the response open for.
  after(() => reconcileWorkspaceSheetShares(ctx.workspaceId))

  invalidate(ctx, { paths: ["/integrations"] })
  return { success: true }
}

/** Re-attempt the shares that failed — the recovery path behind "Re-check access". */
export async function reconcileSheetSharing(ctx: AuthContext): Promise<Result> {
  const denied = authorize(ctx, {
    scopes: ["integrations:write"],
    action: "manage_integrations",
  })
  if (denied) return { success: false, error: denied }

  await reconcileWorkspaceSheetShares(ctx.workspaceId)
  invalidate(ctx, { paths: ["/integrations"] })
  return { success: true }
}
```

In `src/lib/actions/integrations.ts`:

```ts
import type { SheetSharingSetting } from "@/lib/db/schema"

/** Set or clear who gets access to the workspace's response spreadsheets. */
export async function setSheetSharing(share: SheetSharingSetting | null): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.setSheetSharing(session.ctx, share)
}

/** Re-attempt any spreadsheet shares that failed. */
export async function reconcileSheetSharing(): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return integrationsCore.reconcileSheetSharing(session.ctx)
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project=integration tests/integration/integrations-core.test.ts && npx vitest --run --project=unit tests/unit/core-contract.test.ts`
Expected: PASS. `core-contract` guards the shape of the core surface — if it enumerates exports, add the two new names there.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/roles.ts src/lib/core/integrations.ts src/lib/actions/integrations.ts tests/integration/integrations-core.test.ts
git commit -m "feat(sheets): owner-only actions for spreadsheet sharing"
```

---

### Task 8: Read path — the setting and per-member state for the page

**Files:**
- Modify: `src/lib/data/integrations.ts` (`WorkspaceIntegrations` ~line 245-270, `getWorkspaceIntegrations` ~line 272-400)
- Test: `tests/integration/sheets-sharing.test.ts` (extend)

**Interfaces:**
- Consumes: `SheetShare`, `SheetSharingSetting`.
- Produces: `WorkspaceIntegrations.sharing: { setting: SheetSharingSetting | null; members: { email: string; state: "shared" | "blocked" | "failed" | "pending"; reason: SheetShareError | null; sheets: number }[] }`. Whether the viewer may CHANGE it is not part of this type — the page passes that down as a prop, the way it already does for `mcp.isOwner`.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/sheets-sharing.test.ts`:

```ts
describe("what the integrations page is told", () => {
  test("reports the setting and each member's state", async () => {
    const { getWorkspaceIntegrations } = await import("@/lib/data/integrations")
    const s = await seed({ share: { role: "reader", audience: "all" } })
    const members = await sharesOfMembers(s.workspaceId)
    refuse.set(members[1], "domain_policy")
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    const view = await getWorkspaceIntegrations(s.workspaceId)

    expect(view?.sharing.setting).toEqual({ role: "reader", audience: "all" })
    const blocked = view?.sharing.members.find((m) => m.email === members[1])
    expect(blocked?.state).toBe("blocked")
    expect(blocked?.reason).toBe("domain_policy")
    const shared = view?.sharing.members.find((m) => m.email === members[0])
    expect(shared?.state).toBe("shared")
    expect(shared?.sheets).toBe(1)
    // The account that owns the files is not listed as needing access.
    const owner = (await conn(s.workspaceId)).accountEmail
    expect(view?.sharing.members.some((m) => m.email === owner)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts`
Expected: FAIL — `sharing` is undefined on the returned view.

- [ ] **Step 3: Implement**

In `src/lib/data/integrations.ts`, add to `WorkspaceIntegrations`:

```ts
  /**
   * Whether the workspace's members can open the response spreadsheets, and how
   * each of them is actually doing. Rolled up across forms: one blocked member
   * is one row on the card, not one row per form.
   */
  sharing: {
    setting: SheetSharingSetting | null
    members: {
      email: string
      state: "shared" | "blocked" | "failed" | "pending"
      reason: SheetShareError | null
      /** How many of the workspace's spreadsheets they can open. */
      sheets: number
    }[]
  }
```

Add `users`, `workspaceMembers`, and the types `ConnectionMetadata`, `SheetShareError`, `SheetSharingSetting` to the existing `@/lib/db/schema` import, then build the value inside `getWorkspaceIntegrations` (it already has `conn` and the `google_sheets` rows in `byForm`):

```ts
  // Sharing: roll the per-sheet grants up per person. A member with one failure
  // and four successes is "blocked" — the failure is the thing to act on.
  const sheetRows = integrationRows.filter((r) => r.type === "google_sheets")
  const setting = conn ? (connMetadata(conn)?.share ?? null) : null
  const rollup = new Map<
    string,
    { email: string; state: "shared" | "blocked" | "failed" | "pending"; reason: SheetShareError | null; sheets: number }
  >()
  const ownerEmail = conn?.accountEmail?.toLowerCase()
  for (const email of setting ? memberEmailList : []) {
    if (email.toLowerCase() === ownerEmail) continue
    rollup.set(email.toLowerCase(), { email, state: "pending", reason: null, sheets: 0 })
  }
  for (const row of sheetRows) {
    const shares = (row.config as GoogleSheetsIntegrationConfig).shares ?? []
    for (const share of shares) {
      const entry = rollup.get(share.email.toLowerCase())
      if (!entry) continue
      if (share.permissionId) {
        entry.sheets += 1
        if (entry.state === "pending") entry.state = "shared"
      } else if (share.error) {
        entry.state = share.error === "domain_policy" || share.error === "not_a_google_account" ? "blocked" : "failed"
        entry.reason = share.error
      }
    }
  }
```

`memberEmailList` comes from one added query beside the existing ones:

```ts
  const memberEmailList = (
    await db
      .select({ email: users.email })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(users.email)
  ).map((r) => r.email)
```

and `connMetadata` is a two-line local helper so the jsonb cast lives in one place:

```ts
/** The Google half of a connection's metadata, if any. */
function connMetadata(conn: { metadata: ConnectionMetadata | null }) {
  return conn.metadata?.google
}
```

Note: the two connection selects in this file currently project `id` and `accountEmail` — add `metadata: workspaceConnections.metadata` to the Google one. Return `sharing: { setting, members: [...rollup.values()] }` from `getWorkspaceIntegrations`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project=integration tests/integration/sheets-sharing.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS and a clean typecheck (the page component will need the new field; if `tsc` complains there, Task 9 fixes it — do not stub it here).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/integrations.ts tests/integration/sheets-sharing.test.ts
git commit -m "feat(sheets): expose sharing state to the integrations page"
```

---

### Task 9: The control on the Sheets card

**Files:**
- Modify: `src/components/integrations/workspace-integrations.tsx` (the Sheets details panel, ~line 476-510, above the "Forms" heading)
- Create: `src/components/integrations/sheet-sharing-control.tsx`
- Test: `tests/unit/sheet-sharing-control.test.tsx` (create)

**Interfaces:**
- Consumes: `WorkspaceIntegrations["sharing"]` (Task 8); `setSheetSharing`, `reconcileSheetSharing` actions (Task 7).
- Produces: `export function SheetSharingControl({ sharing, accountEmail, canManage }: { sharing: WorkspaceIntegrations["sharing"]; accountEmail: string; canManage: boolean })`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sheet-sharing-control.test.tsx`:

```tsx
/**
 * The sharing control. Two things must be true on screen, because both have
 * been got wrong by products that ship this feature: it must say WHOSE Drive
 * the files are in, and a member who cannot be given access must be told why
 * rather than left looking granted.
 */

import { describe, expect, test, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SheetSharingControl } from "@/components/integrations/sheet-sharing-control"

vi.mock("@/lib/actions/integrations", () => ({
  setSheetSharing: vi.fn(async () => ({ success: true })),
  reconcileSheetSharing: vi.fn(async () => ({ success: true })),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const base = {
  setting: { role: "reader" as const, audience: "all" as const },
  members: [
    { email: "a@acme.com", state: "shared" as const, reason: null, sheets: 3 },
    { email: "b@gmail.com", state: "blocked" as const, reason: "domain_policy" as const, sheets: 0 },
  ],
}

describe("SheetSharingControl", () => {
  test("names the account whose Drive holds the files", () => {
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage />)
    expect(screen.getByText(/owner@acme\.com/)).toBeTruthy()
  })

  test("explains a blocked member instead of implying they have access", () => {
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage />)
    expect(screen.getByText(/outside the domain/i)).toBeTruthy()
  })

  test("a member who cannot manage it sees no controls", () => {
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage={false} />)
    expect(screen.queryByRole("button", { name: /re-check access/i })).toBeNull()
  })

  test("off is a legible state, not an empty panel", () => {
    render(
      <SheetSharingControl
        sharing={{ setting: null, members: [] }}
        accountEmail="owner@acme.com"
        canManage
      />,
    )
    expect(screen.getByText(/only owner@acme\.com can open/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project=unit tests/unit/sheet-sharing-control.test.tsx`
Expected: FAIL — cannot resolve `@/components/integrations/sheet-sharing-control`.

- [ ] **Step 3: Implement**

Create `src/components/integrations/sheet-sharing-control.tsx`. Semicolons and double quotes, matching the other components in this directory:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { setSheetSharing, reconcileSheetSharing } from "@/lib/actions/integrations";
import type { WorkspaceIntegrations } from "@/lib/data/integrations";
import type { SheetShareError } from "@/lib/db/schema";

type Sharing = WorkspaceIntegrations["sharing"];
type Choice = "off" | "reader" | "writer";

/** The chosen state as one of three words, so the button group has one source. */
function choiceOf(sharing: Sharing): Choice {
  if (!sharing.setting) return "off";
  return sharing.setting.role;
}

/**
 * Why someone is missing, in words. "403" explains nothing, and a member who
 * cannot be given access must never render as though they have it.
 */
function reasonText(reason: SheetShareError | null, ownerEmail: string): string {
  const domain = ownerEmail.split("@")[1] ?? "this account";
  switch (reason) {
    case "domain_policy":
      return `${domain} does not allow sharing outside the domain`;
    case "not_a_google_account":
      return "not a Google account";
    default:
      return "could not be shared — try again";
  }
}

/**
 * Who in the workspace can open the response spreadsheets.
 *
 * The files live in ONE person's Drive, which is the fact people get wrong, so
 * the account is named on screen rather than implied.
 */
export function SheetSharingControl({
  sharing,
  accountEmail,
  canManage,
}: {
  sharing: Sharing;
  accountEmail: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const choice = choiceOf(sharing);
  const audience = sharing.setting?.audience ?? "all";
  const needsAttention = sharing.members.some(
    (m) => m.state === "blocked" || m.state === "failed"
  );

  function run(action: () => Promise<{ success: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        showToast(done, { type: "success" });
        router.refresh();
      } else {
        showToast(res.error ?? "Something went wrong", { type: "error", duration: 12000 });
      }
    });
  }

  function choose(next: Choice) {
    if (next === choice) return;
    if (next === "off") {
      run(() => setSheetSharing(null), "Members no longer have access");
      return;
    }
    run(
      () => setSheetSharing({ role: next, audience }),
      next === "reader"
        ? "Members can view the spreadsheets"
        : "Members can edit the spreadsheets"
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <h4 className="text-sm font-medium text-foreground">
        Give members access to response spreadsheets
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Files live in {accountEmail}&apos;s Google Drive.
      </p>

      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["off", "Off"],
              ["reader", "Viewer"],
              ["writer", "Editor"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={choice === value ? "default" : "outline"}
              disabled={pending}
              onClick={() => choose(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      {choice === "off" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Only {accountEmail} can open these spreadsheets.
        </p>
      ) : (
        <>
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={audience === "all" ? "default" : "outline"}
                disabled={pending}
                onClick={() =>
                  run(
                    () => setSheetSharing({ role: choice, audience: "all" }),
                    "Every member gets access"
                  )
                }
              >
                All members
              </Button>
              <Button
                size="sm"
                variant={audience === "all" ? "outline" : "default"}
                disabled={pending || sharing.members.length === 0}
                onClick={() => setPickerOpen(true)}
              >
                Only selected…
              </Button>
            </div>
          ) : null}

          <ul className="mt-3 space-y-1.5">
            {sharing.members.map((m) => (
              <li key={m.email} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-foreground">{m.email}</span>
                <span
                  className={
                    m.state === "shared" || m.state === "pending"
                      ? "shrink-0 text-muted-foreground"
                      : "shrink-0 text-destructive"
                  }
                >
                  {m.state === "shared"
                    ? `shared · ${m.sheets} ${m.sheets === 1 ? "spreadsheet" : "spreadsheets"}`
                    : m.state === "pending"
                      ? "not shared yet"
                      : reasonText(m.reason, accountEmail)}
                </span>
              </li>
            ))}
          </ul>

          {canManage && needsAttention ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={pending}
              onClick={() => run(() => reconcileSheetSharing(), "Access re-checked")}
            >
              Re-check access
            </Button>
          ) : null}
        </>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Every member can already read responses inside MakingFlow — this is for
        people who work in Sheets.
      </p>
    </div>
  );
}
```

**The member picker** behind "Only selected…" is the one piece left to write, and it must not be skipped — `setPickerOpen` above is its hook. Add to the same file: a `const [pickerOpen, setPickerOpen] = React.useState(false)` and a `Sheet` (from `@/components/ui/sheet`, as `sync-integration-card.tsx` uses it) holding a checkbox per `sharing.members` entry, pre-ticked for everyone currently `shared`, with a Save button that calls:

```tsx
run(
  () => setSheetSharing({ role: choice, audience: { emails: ticked } }),
  "Access updated"
);
```

Pre-ticking from the current state matters: an empty list submitted by accident revokes everyone, and that is exactly the click someone will make while exploring the control.

Then mount it in `src/components/integrations/workspace-integrations.tsx`, inside the Google Sheets `SheetContent`, directly above the `Forms` heading block:

```tsx
            {connected && connection ? (
              <SheetSharingControl
                sharing={sharing}
                accountEmail={connection.accountEmail}
                canManage={canManageSharing}
              />
            ) : null}
```

Three supporting edits:

1. Add `sharing` to the destructure at line ~162:

```tsx
  const { configured, connection, allForms, forms, email, webhook, discord, notion, sharing } =
    data;
```

2. Add the prop to `WorkspaceIntegrationsPanel`:

```tsx
export function WorkspaceIntegrationsPanel({
  data,
  mcp,
  canManageSharing,
}: {
  data: WorkspaceIntegrations;
  mcp: McpCardProps;
  /** Owner-only, decided on the server — never re-derived from a role in the client. */
  canManageSharing: boolean;
}) {
```

3. Pass it from `src/app/(dashboard)/integrations/page.tsx`, beside the owner check the MCP card already makes:

```tsx
        <WorkspaceIntegrationsPanel
          data={data}
          canManageSharing={session.ctx.role === "owner"}
          mcp={{ /* unchanged */ }}
        />
```

and import `SheetSharingControl` in the panel file.

- [ ] **Step 4: Run the tests and the whole suite**

Run: `npx vitest --run --project=unit tests/unit/sheet-sharing-control.test.tsx && npx tsc --noEmit -p tsconfig.json && npx eslint src tests`
Expected: PASS, clean typecheck, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/integrations/sheet-sharing-control.tsx src/components/integrations/workspace-integrations.tsx src/app/\(dashboard\)/integrations/page.tsx tests/unit/sheet-sharing-control.test.tsx
git commit -m "feat(sheets): the member-access control on the integrations page"
```

---

### Task 10: Full suite, and the one manual check that matters

**Files:**
- No production changes expected.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified feature.

- [ ] **Step 1: Run every test**

Run: `pnpm test`
Expected: PASS. Pay attention to `tests/integration/sheets-account-switch.test.ts` and `tests/integration/integration-deliveries.test.ts` — both exercise the provisioning paths Task 5 touched.

- [ ] **Step 2: Typecheck and lint the whole project**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src tests`
Expected: both clean.

- [ ] **Step 3: Exercise it against a real Google account**

Sharing is the one part no stub can vouch for. On a dev server against a workspace with a connected Google account and at least two members:

1. `/integrations` → Sheets → set **Viewer**, audience **All members**.
2. Confirm in Drive (as the connected account) that each member appears as a viewer on each `MakingFlow – …` spreadsheet.
3. Open one spreadsheet as a member. It should open read-only.
4. Set **Off**. Confirm the members disappear from Drive's sharing dialog, and that a share you added by hand in Drive is still there.
5. Add a member whose address is outside the account's domain if one exists; confirm the card says blocked with the domain reason and that the other members are unaffected.

Record what you saw in the PR or commit message — particularly whether the domain policy blocked anyone, since that is the expected first-run surprise.

- [ ] **Step 4: Commit any fixes and push**

```bash
git push origin main
```

---

## Notes for whoever implements this

- The account-switch fix in `bfc66e5` is the context for Task 5: an account switch replaces the spreadsheet, and a replacement file has none of the old file's permissions. Sharing that does not follow re-provisioning would quietly lock the team out of the new sheet.
- `isOrphanedSheetConfig` in `src/lib/integrations/sheets-provision.ts` compares a config's `connectionId` to the live connection. Nothing in this plan changes that, and nothing in this plan should — per-form Google accounts are explicitly out of scope, and that comparison is what makes them out of scope.
- Every Drive call needs `supportsAllDrives=true`. If a share silently 404s in manual testing, that flag is the first thing to check.
