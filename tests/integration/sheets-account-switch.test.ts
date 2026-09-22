/**
 * Switching the workspace's Google account.
 *
 * A spreadsheet lives in the Drive of whichever account was connected when it
 * was created. Disconnect that account, connect a different one, and every
 * existing `google_sheets` config names a file the new token cannot touch —
 * Google answers 403 or 404 (verified against the real API on a workspace this
 * had happened to). Nothing detected that: the connection is looked up by
 * workspace + provider, `config.connectionId` was written and never read, and so
 * a form went on "syncing" into a spreadsheet no response could reach, failing
 * in a log nobody watches.
 *
 * These pin the three places that now notice: the eager provisioner, the
 * delivery path, and resuming a paused form. Google itself is stubbed — what is
 * under test is which spreadsheet the form ends up pointing at, not the API
 * calls that make one.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"

let created = 0

vi.mock("@/lib/integrations/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/google")>()
  return {
    ...actual,
    isGoogleConfigured: () => true,
    getValidAccessToken: async () => "test-token",
    createSpreadsheet: async () => {
      created += 1
      return {
        spreadsheetId: `new-sheet-${created}`,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/new-sheet-${created}/edit`,
        sheetId: created,
      }
    },
    setHeaderRow: async () => {},
    getSheetId: async () => 0,
    insertColumns: async () => {},
    appendRow: async () => {},
    appendRows: async () => {},
    getColumnValues: async () => [] as string[],
    deleteRow: async () => {},
    // The grid-addressed surface. A sheet that reports the canonical tags is
    // the uninteresting case here — these tests are about WHICH spreadsheet a
    // form points at, not where the columns inside it sit.
    runBatchUpdate: async () => {},
    searchDeveloperMetadata: async () => [
      { key: "makingflow.row", value: "header", dimension: "ROWS" as const, index: 0, sheetId: 0 },
      { key: "makingflow.col", value: "id", dimension: "COLUMNS" as const, index: 0, sheetId: 0 },
      { key: "makingflow.col", value: "ts", dimension: "COLUMNS" as const, index: 1, sheetId: 0 },
    ],
    readGridRows: async () => [["Submission ID", "Submitted at"]],
    readGridColumn: async () => [] as string[],
    appendCells: async () => {},
    appendCellRows: async () => {},
  }
})

const { db } = await import("@/lib/db")
const { formIntegrations, forms, users, workspaces, workspaceConnections } = await import(
  "@/lib/db/schema"
)
const { ensureFormSheet, syncSubmissionToSheets } = await import("@/lib/integrations/sync")
const integrationsCore = await import("@/lib/core/integrations")
const { getGoogleSheetsState } = await import("@/lib/data/integrations")
const { testContext } = await import("../helpers/context")

type Seeded = {
  userId: string
  workspaceId: string
  formId: string
  /** The grant the spreadsheet was created under — since disconnected. */
  oldConnectionId: string
  /** The account connected now. */
  newConnectionId: string
}

let seq = 0

/** A workspace that has swapped its Google account, holding one form's sheet from the old one. */
async function seedSwappedAccount(opts: { enabled: boolean }): Promise<Seeded> {
  seq += 1
  const unique = `swap-${seq}-${Date.now()}`
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${unique}@example.test`, name: "Owner" })
    .returning({ id: users.id })
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `WS ${unique}`, slug: `ws-${unique}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      title: "Job Application",
      status: "published",
      publicId: `swap${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  // The old grant is gone — disconnecting deletes it — so its id survives only
  // in the config it provisioned. That is the whole signal.
  const oldConnectionId = randomUUID()
  const [newConn] = await db
    .insert(workspaceConnections)
    .values({
      workspaceId: workspace.id,
      provider: "google",
      accountEmail: "teammate@example.test",
      accessToken: "encrypted-placeholder",
    })
    .returning({ id: workspaceConnections.id })

  await db.insert(formIntegrations).values({
    formId: form.id,
    workspaceId: workspace.id,
    type: "google_sheets",
    enabled: opts.enabled,
    config: {
      connectionId: oldConnectionId,
      spreadsheetId: "old-account-sheet",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/old-account-sheet/edit",
      sheetName: "Submissions",
      sheetId: 0,
      hasIdColumn: true,
      columns: [],
    },
  })

  return {
    userId: user.id,
    workspaceId: workspace.id,
    formId: form.id,
    oldConnectionId,
    newConnectionId: newConn.id,
  }
}

async function sheetRow(formId: string) {
  const [row] = await db
    .select({ enabled: formIntegrations.enabled, config: formIntegrations.config })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)
  return row as { enabled: boolean; config: { connectionId: string; spreadsheetId: string } }
}

beforeEach(() => {
  created = 0
})

describe("a sheet left behind by the previous Google account", () => {
  test("is replaced when the form is syncing", async () => {
    const s = await seedSwappedAccount({ enabled: true })

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Job Application" })

    const row = await sheetRow(s.formId)
    expect(row.config.spreadsheetId).toBe("new-sheet-1")
    expect(row.config.connectionId).toBe(s.newConnectionId)
    // Re-provisioning is not a pause: the form was syncing and still is.
    expect(row.enabled).toBe(true)
  })

  test("is left alone when the form is paused", async () => {
    // A reconnect must not create spreadsheets for forms nobody asked to sync;
    // resuming is what provisions one (next test).
    const s = await seedSwappedAccount({ enabled: false })

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Job Application" })

    expect(created).toBe(0)
    expect((await sheetRow(s.formId)).config.spreadsheetId).toBe("old-account-sheet")
  })

  test("is replaced on resume rather than reused", async () => {
    const s = await seedSwappedAccount({ enabled: false })
    const ctx = testContext({ userId: s.userId, workspaceId: s.workspaceId })

    const res = await integrationsCore.enableFormSheet(ctx, s.formId)

    expect(res).toEqual({ success: true })
    const row = await sheetRow(s.formId)
    expect(row.enabled).toBe(true)
    expect(row.config.spreadsheetId).toBe("new-sheet-1")
    expect(row.config.connectionId).toBe(s.newConnectionId)
  })

  test("is replaced when a response arrives, and the delivery still succeeds", async () => {
    const s = await seedSwappedAccount({ enabled: true })

    const outcome = await syncSubmissionToSheets({
      form: {
        id: s.formId,
        workspaceId: s.workspaceId,
        title: "Job Application",
        publicId: "pub-1",
      },
      submission: { id: randomUUID(), submittedAt: new Date() },
      answers: [],
    })

    expect(outcome.ok).toBe(true)
    expect((await sheetRow(s.formId)).config.spreadsheetId).toBe("new-sheet-1")
  })

  test("reads as needing a reconnect rather than as syncing", async () => {
    const s = await seedSwappedAccount({ enabled: true })

    const state = await getGoogleSheetsState(s.formId, s.workspaceId)

    expect(state?.status).toBe("orphaned")
  })
})

describe("a sheet the connected account still owns", () => {
  /** Same shape as above, but the config names the live grant. */
  async function seedCurrent(opts: { enabled: boolean }) {
    const s = await seedSwappedAccount(opts)
    const row = await sheetRow(s.formId)
    await db
      .update(formIntegrations)
      .set({ config: { ...row.config, connectionId: s.newConnectionId } })
      .where(eq(formIntegrations.formId, s.formId))
    return s
  }

  test("is not re-provisioned by the eager pass", async () => {
    const s = await seedCurrent({ enabled: true })

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Job Application" })

    expect(created).toBe(0)
    expect((await sheetRow(s.formId)).config.spreadsheetId).toBe("old-account-sheet")
  })

  test("is reused on resume", async () => {
    const s = await seedCurrent({ enabled: false })
    const ctx = testContext({ userId: s.userId, workspaceId: s.workspaceId })

    await integrationsCore.enableFormSheet(ctx, s.formId)

    expect(created).toBe(0)
    const row = await sheetRow(s.formId)
    expect(row.enabled).toBe(true)
    expect(row.config.spreadsheetId).toBe("old-account-sheet")
  })

  test("reads as syncing", async () => {
    const s = await seedCurrent({ enabled: true })
    expect((await getGoogleSheetsState(s.formId, s.workspaceId))?.status).toBe("syncing")
  })
})
