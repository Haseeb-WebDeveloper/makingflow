/**
 * Sharing the response spreadsheets with the workspace's members.
 *
 * What is worth pinning here is not "it calls Drive" — it is what we do with what
 * Drive says back: a grant is recorded with the id that makes it revocable later,
 * a refusal is recorded against the person it concerns without taking anyone else
 * down with it, and a share we did not create is never removed.
 *
 * Drive and Sheets are stubbed. The database is real.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import type {
  GoogleSheetsIntegrationConfig,
  SheetShare,
  SheetSharingSetting,
} from "@/lib/db/schema"

const shareCalls: { fileId: string; email: string; role: string }[] = []
const unshareCalls: { fileId: string; permissionId: string }[] = []
/** email -> the failure Drive should raise for it */
const refuse = new Map<string, "domain_policy" | "not_a_google_account" | "failed">()

vi.mock("@/lib/integrations/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/google")>()
  return {
    ...actual,
    isGoogleConfigured: () => true,
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
    // The Sheets half, for the provisioning paths these tests reach through.
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
    deleteRow: async () => {},
  }
})

const { db } = await import("@/lib/db")
const { formIntegrations, forms, users, workspaces, workspaceConnections, workspaceMembers } =
  await import("@/lib/db/schema")
const { reconcileSheetShares, reconcileWorkspaceSheetShares } = await import(
  "@/lib/integrations/sheets-sharing"
)

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

  for (const email of [
    `owner-${unique}@acme.test`,
    `a-${unique}@acme.test`,
    `b-${unique}@acme.test`,
  ]) {
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
    .select({
      id: formIntegrations.id,
      formId: formIntegrations.formId,
      config: formIntegrations.config,
    })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)
  return r as { id: string; formId: string; config: GoogleSheetsIntegrationConfig }
}

/** The member addresses that are not the connected account's own. */
async function otherMembers(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(users.email)
  const c = await conn(workspaceId)
  return rows.map((r) => r.email).filter((e) => e !== c.accountEmail)
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
    const members = await otherMembers(s.workspaceId)
    refuse.set(members[0], "domain_policy")

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    const shares = await sharesOf(s.rowId)
    const blocked = shares.find((sh) => sh.email === members[0])
    expect(blocked?.error).toBe("domain_policy")
    expect(blocked?.permissionId).toBeUndefined()
    expect(shares.filter((sh) => sh.permissionId)).toHaveLength(1)
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

  test("narrowing the audience withdraws access from everyone else", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    const members = await otherMembers(s.workspaceId)
    await db
      .update(workspaceConnections)
      .set({ metadata: { google: { share: { role: "reader", audience: { emails: [members[0]] } } } } })
      .where(eq(workspaceConnections.id, s.connId))

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(unshareCalls.map((c) => c.permissionId)).toEqual([`perm-${members[1]}`])
    expect((await sharesOf(s.rowId)).map((sh) => sh.email)).toEqual([members[0]])
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

  test("a workspace with no Google account is a no-op", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await db.delete(workspaceConnections).where(eq(workspaceConnections.id, s.connId))

    await reconcileWorkspaceSheetShares(s.workspaceId)

    expect(shareCalls).toEqual([])
  })
})

describe("a newly created spreadsheet", () => {
  test("is shared as soon as it exists", async () => {
    // A brand-new file has no permissions of its own, so sharing on creation is
    // a requirement rather than an optimisation: otherwise every form a workspace
    // makes after turning this on starts out private again.
    const { ensureFormSheet } = await import("@/lib/integrations/sync")
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await db.delete(formIntegrations).where(eq(formIntegrations.id, s.rowId))

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Job Application" })

    const row = await rowFor(s.formId)
    expect(row.config.spreadsheetId).toBe("new-sheet-1")
    expect((row.config.shares ?? []).filter((sh) => sh.permissionId)).toHaveLength(2)
  })
})

describe("a spreadsheet replaced after an account switch", () => {
  test("is shared with the members again", async () => {
    // THE case this trigger exists for. The replacement is a new file carrying
    // none of the old one's permissions, so without re-sharing, switching the
    // workspace's Google account quietly locks the whole team out.
    const { ensureFormSheet } = await import("@/lib/integrations/sync")
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    const before = await rowFor(s.formId)
    // Point the config at a grant that no longer exists — what disconnecting and
    // reconnecting a different account leaves behind.
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

describe("membership changes", () => {
  test("removing a member withdraws their access", async () => {
    // Leaving the workspace has to mean leaving the data, or "remove member" is a
    // claim nobody checks until it matters.
    //
    // This drives removeMember rather than the reconciler, because the trigger IS
    // the behaviour under test — and note that the integration setup stubs after()
    // to a no-op, so a deferred reconcile would be invisible here and in any other
    // test that tried to check it.
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
    // Removal is an owner's act, and cannot be aimed at the person doing it.
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
    unshareCalls.length = 0

    const res = await teamCore.removeMember(ctx, victim.userId)

    expect(res).toEqual({ success: true })
    expect(unshareCalls).toHaveLength(1)
    expect((await sharesOf(s.rowId)).some((sh) => sh.email === victim.email)).toBe(false)
  })
})

describe("what the integrations page is told", () => {
  test("reports the setting and each member's state", async () => {
    const { getWorkspaceIntegrations } = await import("@/lib/data/integrations")
    const s = await seed({ share: { role: "reader", audience: "all" } })
    const members = await otherMembers(s.workspaceId)
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
    // The account that owns the files is never listed as needing access to them.
    const owner = (await conn(s.workspaceId)).accountEmail
    expect(view?.sharing.members.some((m) => m.email === owner)).toBe(false)
  })

  test("with sharing off there is nothing to report", async () => {
    const { getWorkspaceIntegrations } = await import("@/lib/data/integrations")
    const s = await seed({})

    const view = await getWorkspaceIntegrations(s.workspaceId)

    expect(view?.sharing).toEqual({ setting: null, members: [] })
  })

  test("a member who has not been reached yet reads as pending, not as shared", async () => {
    // The setting is on but nothing has reconciled — the state the card shows
    // between turning it on and the Drive calls finishing.
    const { getWorkspaceIntegrations } = await import("@/lib/data/integrations")
    const s = await seed({ share: { role: "reader", audience: "all" } })

    const view = await getWorkspaceIntegrations(s.workspaceId)

    expect(view?.sharing.members.map((m) => m.state)).toEqual(["pending", "pending"])
  })
})

describe("a form with its own access setting", () => {
  test("shares with only the people that form names", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    const members = await otherMembers(s.workspaceId)
    const row = await rowFor(s.formId)
    await db
      .update(formIntegrations)
      .set({ config: { ...row.config, shareOverride: { role: "writer", audience: { emails: [members[0]] } } } })
      .where(eq(formIntegrations.id, s.rowId))

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(shareCalls.map((c) => [c.email, c.role])).toEqual([[members[0], "writer"]])
  })

  test("can keep itself private while the rest of the workspace is shared", async () => {
    const s = await seed({ share: { role: "reader", audience: "all" } })
    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))
    const row = await rowFor(s.formId)
    await db
      .update(formIntegrations)
      .set({ config: { ...row.config, shareOverride: "none" } })
      .where(eq(formIntegrations.id, s.rowId))

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(unshareCalls).toHaveLength(2)
    expect(await sharesOf(s.rowId)).toEqual([])
  })

  test("is shared even when the workspace shares nothing", async () => {
    const s = await seed({})
    const members = await otherMembers(s.workspaceId)
    const row = await rowFor(s.formId)
    await db
      .update(formIntegrations)
      .set({ config: { ...row.config, shareOverride: { role: "reader", audience: { emails: [members[1]] } } } })
      .where(eq(formIntegrations.id, s.rowId))

    await reconcileSheetShares(await conn(s.workspaceId), await rowFor(s.formId))

    expect(shareCalls.map((c) => c.email)).toEqual([members[1]])
  })
})
