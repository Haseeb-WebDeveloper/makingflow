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

const listTallyFormsMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/import/tally-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/tally-api")>()),
  listTallyForms: listTallyFormsMock,
}))

const importCore = await import("@/lib/core/import-tally")

/** One entry of Tally's form list, as their API returns it. */
function tallySummary(id: string, workspaceName: string | null) {
  return {
    id,
    name: "Job Application",
    status: "published",
    isClosed: false,
    submissionCount: 0,
    workspaceId: workspaceName ? `tally_ws_${workspaceName}` : null,
    workspaceName,
  }
}

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

/**
 * Import a form and stamp it with a Tally external id, as the API-key path's
 * `markImported` does. Used to set up filing, which matches on that stamp.
 */
async function importFormWithExternalId(
  ctx: ReturnType<typeof testContext>,
  externalId: string,
): Promise<string> {
  fetchTallyPage.mockResolvedValue({
    form: tallyForm(),
    skipped: [],
    sourceUrl: "https://tally.so/r/abc123",
  })
  const result = await importCore.importTallyForm(ctx, "https://tally.so/r/abc123")
  if (!result.success) throw new Error(`setup import failed: ${result.error}`)

  const [row] = await db
    .select({ settings: forms.settings })
    .from(forms)
    .where(eq(forms.id, result.formId))
  await db
    .update(forms)
    .set({
      settings: { ...(row?.settings ?? {}), importedFrom: { source: "tally", externalId } },
    })
    .where(eq(forms.id, result.formId))

  return result.formId
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

  describe("fileImportedFormsIntoFolders", () => {
    /**
     * Filing matches OUR forms against a Tally account by external id. Two
     * MakingFlow workspaces that imported the same Tally form therefore hold
     * rows with the SAME external id — so if the lookup were not scoped, one
     * user's Tally key would reorganise another user's forms.
     */
    test("matches only within the caller's workspace, even on a shared external id", async () => {
      const external = `tally_form_${randomUUID()}`
      listTallyFormsMock.mockResolvedValue([tallySummary(external, "Recruiting")])

      // Both tenants imported the same public Tally form.
      const mine = await importFormWithExternalId(alice.ctx, external)
      const theirs = await importFormWithExternalId(bob.ctx, external)

      const result = await importCore.fileImportedFormsIntoFolders(alice.ctx, "tally_key_xyz")
      expect(result).toMatchObject({ success: true, filed: 1, unmatched: 0 })

      const [myForm] = await db
        .select({ folderId: forms.folderId })
        .from(forms)
        .where(and(eq(forms.id, mine), eq(forms.workspaceId, alice.workspaceId)))
      expect(myForm.folderId).not.toBeNull()

      // Bob's identically-sourced form is untouched.
      const [bobsForm] = await db
        .select({ folderId: forms.folderId })
        .from(forms)
        .where(eq(forms.id, theirs))
      expect(bobsForm.folderId).toBeNull()

      // And the folder was created in Alice's workspace only.
      const created = await db
        .select({ workspaceId: folders.workspaceId })
        .from(folders)
        .where(eq(folders.name, "Recruiting"))
      expect(created).toHaveLength(1)
      expect(created[0].workspaceId).toBe(alice.workspaceId)
    })

    test("a Tally form we never imported creates no folder for it", async () => {
      // Filing reorganises what is already here. A form that exists in the
      // Tally account but was never imported is not our business, so it must
      // not conjure an empty folder the user then has to tidy up.
      listTallyFormsMock.mockResolvedValue([
        tallySummary(`tally_form_${randomUUID()}`, "Recruiting"),
      ])

      expect(await importCore.fileImportedFormsIntoFolders(alice.ctx, "tally_key_xyz")).toMatchObject({
        success: true,
        filed: 0,
        folders: [],
      })
      expect(
        await db.select().from(folders).where(eq(folders.workspaceId, alice.workspaceId)),
      ).toHaveLength(0)
    })

    test("a Tally key we cannot use fails with Tally's own message", async () => {
      const { TallyImportError } = await import("@/lib/import/tally-error")
      listTallyFormsMock.mockRejectedValue(
        new TallyImportError("INVALID_KEY", "That API key was rejected by Tally."),
      )

      expect(await importCore.fileImportedFormsIntoFolders(alice.ctx, "bad_key")).toEqual({
        success: false,
        error: "That API key was rejected by Tally.",
      })
    })
  })
})
