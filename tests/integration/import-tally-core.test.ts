/**
 * Tally import, run with no session anywhere in reach.
 *
 * This module used to import `saveAiForm` and `updateFormSettings` from
 * `@/lib/actions/forms` — the `"use server"` wrappers, which resolve the caller
 * from cookies. Under a bearer token that resolution returns nothing and EVERY
 * import failed with "Not signed in", from inside a function that had been
 * handed a perfectly good AuthContext. It was the only cross-action import left
 * in the codebase, and the reason import was the last core conversion.
 *
 * So `@/lib/auth/session` is mocked to THROW here. That is the assertion: if
 * anything on these paths reaches for ambient session state — now or after some
 * future refactor re-adds the convenient import — the test fails loudly instead
 * of quietly passing because a mock handed it the right answer.
 *
 * The network is mocked at `@/lib/import/tally-page`; its parsing is covered by
 * unit tests. What is exercised here is everything after: persistence, tenancy,
 * the CSV join, and idempotency.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  answers,
  folders,
  formFields,
  forms,
  submissions,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import type { EditorForm } from "@/lib/builder/form-model"
import { testContext } from "../helpers/context"

vi.mock("@/lib/auth/session", () => {
  const refuse = () => {
    throw new Error(
      "core/import-tally reached for the session — it must use the AuthContext it was given",
    )
  }
  return {
    getRequiredUser: refuse,
    getDefaultWorkspace: refuse,
    sessionContext: refuse,
    getCurrentUser: refuse,
  }
})

const fetchTallyPage = vi.hoisted(() => vi.fn())
vi.mock("@/lib/import/tally-page", () => ({ importTallyFormFromUrl: fetchTallyPage }))

const fetchTallyFormFromApiMock = vi.hoisted(() => vi.fn())
const resolveTallyGroupNameMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/import/tally-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/tally-api")>()),
  fetchTallyFormFromApi: fetchTallyFormFromApiMock,
  resolveTallyGroupName: resolveTallyGroupNameMock,
}))

const importCore = await import("@/lib/core/import-tally")

/** What the page parser hands back for a two-question form. */
function tallyForm(overrides: Partial<EditorForm> = {}): EditorForm {
  return {
    title: "Job Application",
    fields: [
      { id: randomUUID(), type: "short_text", label: "Full name", required: true },
      {
        id: randomUUID(),
        type: "multiple_choice",
        label: "Role",
        required: false,
        options: [
          { id: randomUUID(), label: "Engineer" },
          { id: randomUUID(), label: "Designer" },
        ],
      },
    ],
    ...overrides,
  }
}

let seq = 0

async function seedTenant(label: string) {
  seq += 1
  const unique = `${label}-${seq}-${Date.now()}`
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${unique}@example.test`, name: label })
    .returning({ id: users.id })
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `WS ${unique}`, slug: `ws-${unique}` })
    .returning({ id: workspaces.id })
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })

  return {
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
    workspaceId: workspace.id,
  }
}

/** What the API reader hands back for one form, grouping included. */
function apiForm(groupId: string | null) {
  return { form: tallyForm(), skipped: [], refs: [], groupId }
}

/** Field ids as stored, keyed by label — the CSV joins on the label. */
async function fieldsOf(formId: string) {
  const rows = await db
    .select({ id: formFields.id, label: formFields.label })
    .from(formFields)
    .where(eq(formFields.formId, formId))
  return rows
}

describe("core/import-tally", () => {
  let alice: Awaited<ReturnType<typeof seedTenant>>
  let bob: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    vi.clearAllMocks()
    alice = await seedTenant("alice")
    bob = await seedTenant("bob")
  })

  describe("importTallyForm", () => {
    test("persists the form into the caller's workspace without a session", async () => {
      fetchTallyPage.mockResolvedValue({
        form: tallyForm(),
        skipped: [{ type: "payment", label: "Pay now" }],
        sourceUrl: "https://tally.so/r/abc123",
      })

      const result = await importCore.importTallyForm(alice.ctx, "https://tally.so/r/abc123")
      if (!result.success) throw new Error(`import failed: ${result.error}`)

      expect(result.title).toBe("Job Application")
      expect(result.fieldCount).toBe(2)
      expect(result.skipped).toEqual([{ type: "payment", label: "Pay now" }])

      const [row] = await db
        .select({ workspaceId: forms.workspaceId, title: forms.title, status: forms.status })
        .from(forms)
        .where(eq(forms.id, result.formId))
      // The workspace came from the context, which is the whole point.
      expect(row.workspaceId).toBe(alice.workspaceId)
      expect(row.title).toBe("Job Application")
      // Imported as a draft — nothing goes live without the user publishing it.
      expect(row.status).toBe("draft")
      expect(await fieldsOf(result.formId)).toHaveLength(2)
    })

    test("carries the form's settings across", async () => {
      fetchTallyPage.mockResolvedValue({
        form: tallyForm({
          settings: { showProgressBar: true, redirectUrl: "https://acme.test/thanks" },
        }),
        skipped: [],
        sourceUrl: "https://tally.so/r/abc123",
      })

      const result = await importCore.importTallyForm(alice.ctx, "https://tally.so/r/abc123")
      if (!result.success) throw new Error(`import failed: ${result.error}`)

      // The redirect is a column; the progress bar lives in the settings jsonb.
      const [row] = await db
        .select({ redirectUrl: forms.redirectUrl, settings: forms.settings })
        .from(forms)
        .where(eq(forms.id, result.formId))
      expect(row.redirectUrl).toBe("https://acme.test/thanks")
      expect(row.settings?.showProgressBar).toBe(true)
    })

    test("a form with nothing importable creates nothing", async () => {
      fetchTallyPage.mockResolvedValue({
        form: tallyForm({ fields: [] }),
        skipped: [{ type: "payment", label: "Pay now" }],
        sourceUrl: "https://tally.so/r/empty",
      })

      const result = await importCore.importTallyForm(alice.ctx, "https://tally.so/r/empty")
      expect(result).toEqual({
        success: false,
        error: "That form has no questions we can import yet — nothing was created.",
      })
      // Not a half-made empty draft the user has to go and delete.
      expect(
        await db.select().from(forms).where(eq(forms.workspaceId, alice.workspaceId)),
      ).toHaveLength(0)
    })

    test("a fetcher error reaches the user as its own message", async () => {
      const { TallyImportError } = await import("@/lib/import/tally-error")
      fetchTallyPage.mockRejectedValue(
        new TallyImportError("NOT_FOUND", "We couldn't find that form."),
      )

      expect(await importCore.importTallyForm(alice.ctx, "https://tally.so/r/gone")).toEqual({
        success: false,
        error: "We couldn't find that form.",
      })
    })
  })

  describe("importTallySubmissions", () => {
    let formId: string
    let csv: string

    beforeEach(async () => {
      fetchTallyPage.mockResolvedValue({
        form: tallyForm(),
        skipped: [],
        sourceUrl: "https://tally.so/r/abc123",
      })
      const result = await importCore.importTallyForm(alice.ctx, "https://tally.so/r/abc123")
      if (!result.success) throw new Error(`setup import failed: ${result.error}`)
      formId = result.formId

      // Tally's export: an id column, a timestamp, then one column per question
      // matched on the label.
      csv = [
        "Submission ID,Submitted at,Full name,Role",
        "sub_1,2026-01-04T10:00:00Z,Ada Lovelace,Engineer",
        "sub_2,2026-01-05T11:30:00Z,Grace Hopper,Designer",
      ].join("\n")
    })

    test("loads responses and dates them from the export, not from now", async () => {
      const result = await importCore.importTallySubmissions(alice.ctx, formId, csv)
      expect(result).toMatchObject({ success: true, imported: 2, duplicates: 0 })

      const rows = await db
        .select({ id: submissions.id, createdAt: submissions.createdAt, status: submissions.status })
        .from(submissions)
        .where(eq(submissions.formId, formId))
        .orderBy(submissions.createdAt)
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.status === "completed")).toBe(true)
      // Dating imported history to the moment of import would flatten every
      // insights chart it feeds.
      expect(rows[0].createdAt.toISOString()).toBe("2026-01-04T10:00:00.000Z")
      expect(rows[1].createdAt.toISOString()).toBe("2026-01-05T11:30:00.000Z")

      const answerRows = await db
        .select({ question: answers.question, value: answers.value })
        .from(answers)
        .where(eq(answers.submissionId, rows[0].id))
      expect(answerRows).toEqual(
        expect.arrayContaining([{ question: "Full name", value: "Ada Lovelace" }]),
      )
    })

    test("re-uploading the same export adds nothing", async () => {
      await importCore.importTallySubmissions(alice.ctx, formId, csv)
      const again = await importCore.importTallySubmissions(alice.ctx, formId, csv)

      expect(again).toMatchObject({ success: true, imported: 0, duplicates: 2 })
      expect(await db.select().from(submissions).where(eq(submissions.formId, formId))).toHaveLength(2)
    })

    test("a later export containing the same rows adds only what is new", async () => {
      await importCore.importTallySubmissions(alice.ctx, formId, csv)
      const bigger = `${csv}\nsub_3,2026-01-06T09:00:00Z,Katherine Johnson,Engineer`

      expect(await importCore.importTallySubmissions(alice.ctx, formId, bigger)).toMatchObject({
        success: true,
        imported: 1,
        duplicates: 2,
      })
      expect(await db.select().from(submissions).where(eq(submissions.formId, formId))).toHaveLength(3)
    })

    test("cannot load responses into another tenant's form", async () => {
      expect(await importCore.importTallySubmissions(bob.ctx, formId, csv)).toEqual({
        success: false,
        error: "Form not found",
      })
      expect(await db.select().from(submissions).where(eq(submissions.formId, formId))).toHaveLength(0)
    })

    test("an export for a different form is refused rather than half-imported", async () => {
      const wrong = ["Submission ID,Submitted at,Favourite colour", "sub_9,2026-01-04T10:00:00Z,Blue"].join("\n")

      const result = await importCore.importTallySubmissions(alice.ctx, formId, wrong)
      expect(result).toEqual({
        success: false,
        error:
          "None of its columns matched this form's questions. Make sure it's the export for this form.",
      })
      expect(await db.select().from(submissions).where(eq(submissions.formId, formId))).toHaveLength(0)
    })
  })

  /**
   * Filing is part of importing, not a step afterwards. It used to be a button
   * the user had to find and press, which meant a 68-form migration landed in
   * one flat list and stayed there. These pin the two ways it can go wrong: not
   * happening at all, and happening into the wrong tenant's folder.
   */
  describe("importTallyFormFromApiKey — folders", () => {
    const KEY = "tly_key_xyz"

    test("files the form under its Tally workspace, in the caller's tenant only", async () => {
      const external = `tally_form_${randomUUID()}`
      fetchTallyFormFromApiMock.mockResolvedValue(apiForm("tally_ws_1"))
      resolveTallyGroupNameMock.mockResolvedValue("Recruiting")

      // Both tenants import the same Tally form, so both hold the same external
      // id. Folders are per workspace; neither may reach the other's.
      const mine = await importCore.importTallyFormFromApiKey(alice.ctx, KEY, external, false)
      const theirs = await importCore.importTallyFormFromApiKey(bob.ctx, KEY, external, false)
      if (!mine.success || !theirs.success) throw new Error("import failed")

      expect(mine.folder).toBe("Recruiting")

      const created = await db
        .select({ id: folders.id, workspaceId: folders.workspaceId })
        .from(folders)
        .where(eq(folders.name, "Recruiting"))
      expect(created).toHaveLength(2)
      expect(new Set(created.map((f) => f.workspaceId))).toEqual(
        new Set([alice.workspaceId, bob.workspaceId]),
      )

      const [myForm] = await db
        .select({ folderId: forms.folderId })
        .from(forms)
        .where(and(eq(forms.id, mine.formId), eq(forms.workspaceId, alice.workspaceId)))
      const alicesFolder = created.find((f) => f.workspaceId === alice.workspaceId)
      expect(myForm.folderId).toBe(alicesFolder!.id)
    })

    test("resolves the workspace itself when the caller did not look it up", async () => {
      // The MCP path holds a form id and nothing else. Omitting folderName must
      // mean "find out", not "leave it unfiled".
      fetchTallyFormFromApiMock.mockResolvedValue(apiForm("tally_ws_1"))
      resolveTallyGroupNameMock.mockResolvedValue("Recruiting")

      const result = await importCore.importTallyFormFromApiKey(
        alice.ctx,
        KEY,
        `tally_form_${randomUUID()}`,
        false,
      )
      expect(result).toMatchObject({ success: true, folder: "Recruiting" })
      expect(resolveTallyGroupNameMock).toHaveBeenCalledWith(KEY, "tally_ws_1")
    })

    test("takes the caller's answer without asking Tally again", async () => {
      // The web path already knows every form's workspace from the list it
      // showed. Re-resolving here would cost one request per form on a
      // migration Tally rate-limits at 100 a minute.
      fetchTallyFormFromApiMock.mockResolvedValue(apiForm("tally_ws_1"))

      const result = await importCore.importTallyFormFromApiKey(
        alice.ctx,
        KEY,
        `tally_form_${randomUUID()}`,
        false,
        { folderName: "Senior" },
      )
      expect(result).toMatchObject({ success: true, folder: "Senior" })
      expect(resolveTallyGroupNameMock).not.toHaveBeenCalled()
    })

    test("an explicit null means unfiled, and asks nobody", async () => {
      // The caller looked and this form has no Tally grouping. Distinct from
      // omitting the option, which means it never looked.
      fetchTallyFormFromApiMock.mockResolvedValue(apiForm("tally_ws_1"))

      const result = await importCore.importTallyFormFromApiKey(
        alice.ctx,
        KEY,
        `tally_form_${randomUUID()}`,
        false,
        { folderName: null },
      )
      expect(result).toMatchObject({ success: true, folder: null })
      expect(resolveTallyGroupNameMock).not.toHaveBeenCalled()
      expect(
        await db.select().from(folders).where(eq(folders.workspaceId, alice.workspaceId)),
      ).toHaveLength(0)
    })

    test("keeps the form when the workspace lookup fails, and says it is unfiled", async () => {
      // Losing a folder name must never cost the user the import that was
      // otherwise about to succeed.
      const { TallyImportError } = await import("@/lib/import/tally-error")
      fetchTallyFormFromApiMock.mockResolvedValue(apiForm("tally_ws_1"))
      resolveTallyGroupNameMock.mockRejectedValue(
        new TallyImportError("FORBIDDEN", "That key cannot read workspaces."),
      )

      const result = await importCore.importTallyFormFromApiKey(
        alice.ctx,
        KEY,
        `tally_form_${randomUUID()}`,
        false,
      )
      expect(result).toMatchObject({ success: true, folder: null })
      if (!result.success) throw new Error("import failed")
      const [row] = await db
        .select({ folderId: forms.folderId })
        .from(forms)
        .where(eq(forms.id, result.formId))
      expect(row.folderId).toBeNull()
    })

    test("does not re-resolve on the passes that continue a large import", async () => {
      // Pass one filed the form. A form with thousands of responses comes round
      // a dozen times; paying for the same answer each time is how a migration
      // hits Tally's rate limit.
      fetchTallyFormFromApiMock.mockResolvedValue(apiForm("tally_ws_1"))

      await importCore.importTallyFormFromApiKey(
        alice.ctx,
        KEY,
        `tally_form_${randomUUID()}`,
        false,
        { startPage: 2 },
      )
      expect(resolveTallyGroupNameMock).not.toHaveBeenCalled()
    })
  })
})
