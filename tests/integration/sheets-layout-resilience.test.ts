/**
 * What happens to a response when the owner has been editing the spreadsheet.
 *
 * Reported from one live sheet, all at once: new submissions arriving ABOVE the
 * header rather than at the bottom, a retry writing the same response twice, and
 * deleting a response in MakingFlow leaving its row behind. One cause — the sync
 * assumed the header was row 1 and the Submission ID column A, and the owner had
 * inserted a row above the header while restyling it.
 *
 * Every test below is a real edit somebody made to a real spreadsheet: hiding a
 * column, dragging one, inserting one in the middle, renaming the tab, adding a
 * question afterwards. The rule they all pin is the same: the response lands as
 * one complete row at the BOTTOM, under the right headers, whatever was done to
 * the sheet first.
 *
 * Google is stubbed. What is under test is which cells we ask for, not the HTTP
 * that carries the request — `tests/unit/sheets-grid-api.test.ts` covers that.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import type { MetadataTag } from "@/lib/integrations/sheet-layout"

type CreatedMetadata = NonNullable<SheetsRequest["createDeveloperMetadata"]>["developerMetadata"]

/** Only the parts of a Sheets batchUpdate request these tests look at. */
type SheetsRequest = {
  createDeveloperMetadata?: {
    developerMetadata: {
      metadataKey: string
      metadataValue: string
      location: {
        dimensionRange: { sheetId: number; dimension: "ROWS" | "COLUMNS"; startIndex: number }
      }
    }
  }
  updateCells?: {
    start: { sheetId: number; rowIndex: number; columnIndex: number }
    rows: { values: { userEnteredValue?: { stringValue: string } }[] }[]
  }
  appendCells?: unknown
  insertDimension?: unknown
  deleteDimension?: unknown
}

// Mutable fake-spreadsheet state the mock factory reads. Module scope because
// vi.mock factories are hoisted above imports and cannot close over anything
// declared later.
let tags: MetadataTag[] = []
let idColumnValues: string[] = []
let gridRows: string[][] = []
const batchRequests: { spreadsheetId: string; requests: SheetsRequest[] }[] = []
const appended: { sheetId: number; cells: (string | null)[] }[] = []
const deletedRows: number[] = []

vi.mock("@/lib/integrations/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/google")>()
  return {
    ...actual,
    isGoogleConfigured: () => true,
    getValidAccessToken: async () => "test-token",
    createSpreadsheet: async () => ({
      spreadsheetId: "sheet-1",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      sheetId: 0,
    }),
    getSheetId: async () => 0,
    // Applies what it is told, so a second read sees the first write. Without
    // that a reconcile straight after provisioning would find an untagged sheet
    // and "migrate" one we had just tagged ourselves.
    runBatchUpdate: async (_t: string, spreadsheetId: string, requests: SheetsRequest[]) => {
      batchRequests.push({ spreadsheetId, requests })
      for (const r of requests) {
        const meta = r.createDeveloperMetadata?.developerMetadata
        if (meta) {
          const range = meta.location.dimensionRange
          tags.push({
            key: meta.metadataKey,
            value: meta.metadataValue,
            dimension: range.dimension,
            index: range.startIndex,
            sheetId: range.sheetId,
          })
        }
        const write = r.updateCells
        if (write) {
          const { rowIndex, columnIndex } = write.start
          while (gridRows.length <= rowIndex) gridRows.push([])
          const row = gridRows[rowIndex]
          while (row.length <= columnIndex) row.push("")
          row[columnIndex] = write.rows[0].values[0].userEnteredValue?.stringValue ?? ""
        }
      }
    },
    searchDeveloperMetadata: async () => tags,
    appendCells: async (_t: string, _s: string, sheetId: number, cells: (string | null)[]) => {
      appended.push({ sheetId, cells })
    },
    appendCellRows: async (_t: string, _s: string, sheetId: number, rows: (string | null)[][]) => {
      for (const cells of rows) appended.push({ sheetId, cells })
    },
    readGridColumn: async () => idColumnValues,
    readGridRows: async () => gridRows,
    deleteRow: async (_t: string, _s: string, _sheetId: number, rowIndex: number) => {
      deletedRows.push(rowIndex)
    },
  }
})

const { db } = await import("@/lib/db")
const { answers, formFields, formIntegrations, forms, submissions, users, workspaces, workspaceConnections } =
  await import("@/lib/db/schema")
const { backfillFormSheet, deleteSubmissionFromSheet, ensureFormSheet, syncSubmissionToSheets } =
  await import("@/lib/integrations/sync")

/** A COLUMNS tag as searchDeveloperMetadata would return it. */
const colTag = (value: string, index: number) => ({
  key: "makingflow.col",
  value,
  dimension: "COLUMNS" as const,
  index,
  sheetId: 0,
})
/** A ROWS tag as searchDeveloperMetadata would return it. */
const rowTag = (value: string, index: number) => ({
  key: "makingflow.row",
  value,
  dimension: "ROWS" as const,
  index,
  sheetId: 0,
})

/** Every request sent to Sheets this test, flattened. */
const allRequests = (): SheetsRequest[] => batchRequests.flatMap((b) => b.requests)
/** The developerMetadata payloads we asked Sheets to create. */
const createdTags = (): CreatedMetadata[] =>
  allRequests()
    .map((r) => r.createDeveloperMetadata?.developerMetadata)
    .filter((m): m is CreatedMetadata => m !== undefined)

type Seeded = {
  userId: string
  workspaceId: string
  formId: string
  connectionId: string
  submissionId: string
  fieldIds: string[]
}

let seq = 0

type SeedOpts = {
  /** Questions the sheet already has columns for, in `config.columns`. */
  columns?: { fieldId: string; label: string }[]
  /** A question on the FORM but absent from config.columns — repair must add it. */
  extraField?: { label: string }
  /** What the stored config calls the tab. */
  sheetName?: string
  /** Omit the form_integrations row entirely (nothing provisioned yet). */
  withoutSheet?: boolean
}

/**
 * A published form with a Google connection, and — unless `withoutSheet` — a
 * spreadsheet already provisioned for it.
 *
 * `columns` is what the STORED CONFIG believes; where those columns physically
 * sit is decided by the `tags` each test sets. That split is the whole point:
 * the config no longer decides position.
 */
async function seed(opts: SeedOpts = {}): Promise<Seeded> {
  seq += 1
  const unique = `layout-${seq}-${Date.now()}`
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
      title: "Application",
      status: "published",
      publicId: `lay${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })
  const [conn] = await db
    .insert(workspaceConnections)
    .values({
      workspaceId: workspace.id,
      provider: "google",
      accountEmail: `${unique}@gmail.test`,
      accessToken: "encrypted-placeholder",
    })
    .returning({ id: workspaceConnections.id })

  // Form fields, in order. Each stored column gets one; `extraField` gets one
  // too but is deliberately left out of config.columns.
  const wanted = [
    ...(opts.columns ?? []).map((c) => ({ id: c.fieldId, label: c.label })),
    ...(opts.extraField ? [{ id: undefined, label: opts.extraField.label }] : []),
  ]
  const fieldIds: string[] = []
  for (const [i, f] of wanted.entries()) {
    const [inserted] = await db
      .insert(formFields)
      .values({
        ...(f.id ? { id: f.id } : {}),
        formId: form.id,
        type: "short_text",
        label: f.label,
        position: i,
      })
      .returning({ id: formFields.id })
    fieldIds.push(inserted.id)
  }

  const [submission] = await db
    .insert(submissions)
    .values({
      formId: form.id,
      workspaceId: workspace.id,
      status: "completed",
      completedAt: new Date("2026-09-22T08:00:00.000Z"),
    })
    .returning({ id: submissions.id })

  if (!opts.withoutSheet) {
    await db.insert(formIntegrations).values({
      formId: form.id,
      workspaceId: workspace.id,
      type: "google_sheets",
      enabled: true,
      config: {
        connectionId: conn.id,
        spreadsheetId: "sheet-1",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
        sheetName: opts.sheetName ?? "Submissions",
        sheetId: 0,
        hasIdColumn: true,
        columns: opts.columns ?? [],
      },
    })
  }

  return {
    userId: user.id,
    workspaceId: workspace.id,
    formId: form.id,
    connectionId: conn.id,
    submissionId: submission.id,
    fieldIds,
  }
}

/** One delivery's worth of content, matching what loadDeliveryContent builds. */
function content(s: Seeded, byField: Record<string, string>) {
  return {
    form: {
      id: s.formId,
      workspaceId: s.workspaceId,
      title: "Application",
      publicId: "lay",
    },
    submission: { id: s.submissionId, submittedAt: new Date("2026-09-22T08:00:00.000Z") },
    answers: Object.entries(byField).map(([fieldId, value]) => ({
      fieldId,
      question: fieldId,
      value,
    })),
  }
}

async function googleConn(workspaceId: string) {
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
  return conn
}

async function storedConfig(formId: string) {
  const [row] = await db
    .select({ config: formIntegrations.config })
    .from(formIntegrations)
    .where(and(eq(formIntegrations.formId, formId), eq(formIntegrations.type, "google_sheets")))
    .limit(1)
  return row?.config as { columns?: { fieldId: string; label: string }[] } | undefined
}

beforeEach(() => {
  tags = []
  idColumnValues = []
  gridRows = []
  batchRequests.length = 0
  appended.length = 0
  deletedRows.length = 0
})

// ── Task 4: provisioning ────────────────────────────────────────────────────

describe("provisioning a sheet", () => {
  test("tags the header row and every column so the layout can be found again", async () => {
    const s = await seed({ columns: [], withoutSheet: true })
    await db.insert(formFields).values([
      { formId: s.formId, type: "short_text", label: "Full name", position: 0 },
      { formId: s.formId, type: "email", label: "Email", position: 1 },
      // Not a question — must not get a column.
      { formId: s.formId, type: "heading", label: "About you", position: 2 },
    ])

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Application" })

    const created = createdTags()
    expect(created).toContainEqual(
      expect.objectContaining({ metadataKey: "makingflow.row", metadataValue: "header" }),
    )
    expect(created).toContainEqual(
      expect.objectContaining({ metadataKey: "makingflow.col", metadataValue: "id" }),
    )
    expect(created).toContainEqual(
      expect.objectContaining({ metadataKey: "makingflow.col", metadataValue: "ts" }),
    )
    expect(created.filter((m) => String(m.metadataValue).startsWith("f:"))).toHaveLength(2)
  })

  test("writes the header cells in the same call that tags them", async () => {
    const s = await seed({ columns: [], withoutSheet: true })
    await db
      .insert(formFields)
      .values({ formId: s.formId, type: "short_text", label: "Full name", position: 0 })

    await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Application" })

    const headerWrites = allRequests()
      .filter((r) => r.updateCells)
      .map((r) => r.updateCells?.rows[0].values[0].userEnteredValue?.stringValue)
    expect(headerWrites).toEqual(["Submission ID", "Submitted at", "Full name"])
    // One atomic batchUpdate: a half-tagged sheet is worse than an untagged one.
    expect(batchRequests).toHaveLength(1)
  })
})

// ── Task 5: reconcile, migrate, repair ──────────────────────────────────────

describe("an untagged sheet from before this feature", () => {
  test("is migrated to tags without moving any data", async () => {
    const s = await seed({
      columns: [
        { fieldId: randomUUID(), label: "Full name" },
        { fieldId: randomUUID(), label: "Email" },
      ],
    })
    tags = []
    gridRows = [["Submission ID", "Submitted at", "Full name", "Email"]]

    await syncSubmissionToSheets(content(s, { [s.fieldIds[0]]: "Ada" }))

    expect(createdTags().map((m) => m.metadataValue).sort()).toEqual([
      "header",
      "id",
      `f:${s.fieldIds[0]}`,
      `f:${s.fieldIds[1]}`,
      "ts",
    ].sort())
    // Nothing was inserted, deleted or shifted.
    expect(allRequests().filter((r) => r.insertDimension)).toEqual([])
    expect(allRequests().filter((r) => r.deleteDimension)).toEqual([])
  })

  test("is migrated at the header's real row, not row 1", async () => {
    const s = await seed({ columns: [{ fieldId: randomUUID(), label: "Full name" }] })
    tags = []
    gridRows = [[], ["Submission ID", "Submitted at", "Full name"]]

    await syncSubmissionToSheets(content(s, { [s.fieldIds[0]]: "Ada" }))

    const headerTag = createdTags().find((m) => m.metadataValue === "header")
    expect(headerTag?.location.dimensionRange.startIndex).toBe(1)
    expect(headerTag?.location.dimensionRange.dimension).toBe("ROWS")
  })

  test("maps each stored column onto the physical column with its label", async () => {
    const s = await seed({
      columns: [
        { fieldId: randomUUID(), label: "Full name" },
        { fieldId: randomUUID(), label: "Email" },
      ],
    })
    tags = []
    // The owner moved Email left of Full name and added a column of their own.
    gridRows = [["Submission ID", "Submitted at", "Email", "Notes", "Full name"]]

    await syncSubmissionToSheets(content(s, {}))

    const at = (value: string) =>
      createdTags().find((m) => m.metadataValue === value)?.location.dimensionRange.startIndex
    expect(at(`f:${s.fieldIds[1]}`)).toBe(2)
    expect(at(`f:${s.fieldIds[0]}`)).toBe(4)
  })
})

describe("reconciling a tagged sheet", () => {
  test("gives a newly added question a column past the last one we own", async () => {
    const fieldId = randomUUID()
    const s = await seed({
      columns: [{ fieldId, label: "Full name" }],
      extraField: { label: "Email" },
    })
    tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    // Column 3 is the owner's own "My notes".
    gridRows = [["Submission ID", "Submitted at", "Full name", "My notes"]]

    await syncSubmissionToSheets(content(s, {}))

    const added = createdTags().find((m) => m.metadataValue === `f:${s.fieldIds[1]}`)
    expect(added?.location.dimensionRange.startIndex).toBe(4)
  })

  test("rewrites only the header cell of a question the form renamed", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    await db.update(formFields).set({ label: "Your full name" }).where(eq(formFields.id, fieldId))
    tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [["Submission ID", "Submitted at", "Full name", "Owner's column"]]

    await syncSubmissionToSheets(content(s, {}))

    const writes = allRequests().filter((r) => r.updateCells)
    expect(writes).toHaveLength(1)
    expect(writes[0].updateCells?.start.columnIndex).toBe(2)
    expect(writes[0].updateCells?.rows[0].values[0].userEnteredValue?.stringValue).toBe(
      "Your full name",
    )
  })

  test("is still found after the owner renames the tab", async () => {
    const fieldId = randomUUID()
    const s = await seed({
      columns: [{ fieldId, label: "Full name" }],
      sheetName: "Responses (do not edit)",
    })
    tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [["Submission ID", "Submitted at", "Full name"]]

    const outcome = await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(outcome).toEqual({ ok: true })
    expect(appended).toHaveLength(1)
  })

  test("persists the grown column list so the next delivery skips the repair", async () => {
    const fieldId = randomUUID()
    const s = await seed({
      columns: [{ fieldId, label: "Full name" }],
      extraField: { label: "Email" },
    })
    tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [["Submission ID", "Submitted at", "Full name"]]

    await syncSubmissionToSheets(content(s, {}))

    const config = await storedConfig(s.formId)
    expect(config?.columns?.map((c) => c.fieldId)).toEqual([fieldId, s.fieldIds[1]])
  })
})

// ── Task 6: writing the submission ──────────────────────────────────────────

describe("a submission arriving at an edited sheet", () => {
  /** Seed a one-question form whose column sits wherever `tags` says. */
  async function oneQuestion(layout: { id: number; ts: number; f1: number; header?: number }) {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [
      rowTag("header", layout.header ?? 0),
      colTag("id", layout.id),
      colTag("ts", layout.ts),
      colTag(`f:${fieldId}`, layout.f1),
    ]
    gridRows = [["Submission ID", "Submitted at", "Full name"]]
    return { s, fieldId }
  }

  test("lands complete when the Submission ID column is hidden", async () => {
    // Hiding sets hiddenByUser on the dimension; the values are untouched, so
    // this must be a complete no-op for us.
    const { s, fieldId } = await oneQuestion({ id: 0, ts: 1, f1: 2 })

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(appended).toHaveLength(1)
    expect(appended[0].cells).toEqual([
      s.submissionId,
      "2026-09-22T08:00:00.000Z",
      "Ada",
    ])
  })

  test("is not shifted by a column inserted at the very start", async () => {
    // The owner inserted a column before ours; Sheets moved every tag right.
    const { s, fieldId } = await oneQuestion({ id: 1, ts: 2, f1: 3 })

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(appended[0].cells).toEqual([null, s.submissionId, "2026-09-22T08:00:00.000Z", "Ada"])
  })

  test("leaves a column inserted between ours untouched", async () => {
    const { s, fieldId } = await oneQuestion({ id: 0, ts: 1, f1: 3 })

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(appended[0].cells[2]).toBeNull()
  })

  test("does not reach a column the owner added on the right", async () => {
    // Trimming at the last column we own is what lets an ARRAYFORMULA there
    // go on spilling into each new row.
    const { s, fieldId } = await oneQuestion({ id: 0, ts: 1, f1: 2 })

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(appended[0].cells).toHaveLength(3)
  })

  test("follows the id column after the owner drags it to the far right", async () => {
    const { s, fieldId } = await oneQuestion({ id: 3, ts: 0, f1: 1 })

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(appended[0].cells).toEqual(["2026-09-22T08:00:00.000Z", "Ada", null, s.submissionId])
  })

  // The bug that started this: a blank row above the header pulled appends to
  // the top, because values.append does table detection and appendCells does not.
  test("goes to the bottom even with a stray row above the header", async () => {
    const { s, fieldId } = await oneQuestion({ id: 0, ts: 1, f1: 2, header: 1 })

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }))

    expect(appended).toHaveLength(1)
    // Nothing was written AT a row index — only appended past the end.
    expect(allRequests().some((r) => r.updateCells?.start?.rowIndex === 0)).toBe(false)
  })
})

describe("retrying a delivery", () => {
  // With the header on row 2, .slice(1) dropped a real id from the seen set,
  // so the retry appended the response a second time.
  test("does not duplicate the row when the header is not on row 1", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [[], ["Submission ID", "Submitted at", "Full name"]]
    idColumnValues = ["stray value in row 1", "Submission ID", s.submissionId]

    const outcome = await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }), {
      verifyFirst: true,
    })

    expect(outcome).toEqual({ ok: true })
    expect(appended).toHaveLength(0)
  })

  test("still appends when the sheet genuinely lacks the row", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [[], ["Submission ID", "Submitted at", "Full name"]]
    idColumnValues = ["stray", "Submission ID", "someone-else"]

    await syncSubmissionToSheets(content(s, { [fieldId]: "Ada" }), { verifyFirst: true })

    expect(appended).toHaveLength(1)
  })
})

describe("deleting a submission", () => {
  test("removes the right row when the header is not on row 1", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [[], ["Submission ID", "Submitted at", "Full name"]]
    idColumnValues = ["stray", "Submission ID", "other-sub", s.submissionId]

    await deleteSubmissionFromSheet({ id: s.formId, workspaceId: s.workspaceId }, s.submissionId)

    expect(deletedRows).toEqual([3])
  })

  // Row 1 holds data, not a header. Skipping index 0 unconditionally meant that
  // response could never be removed.
  test("can remove a row sitting above the header", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [[], ["Submission ID", "Submitted at", "Full name"]]
    idColumnValues = [s.submissionId, "Submission ID", "other-sub"]

    await deleteSubmissionFromSheet({ id: s.formId, workspaceId: s.workspaceId }, s.submissionId)

    expect(deletedRows).toEqual([0])
  })

  test("does nothing when the id is not in the sheet", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    idColumnValues = ["Submission ID", "other-sub"]

    await deleteSubmissionFromSheet({ id: s.formId, workspaceId: s.workspaceId }, s.submissionId)

    expect(deletedRows).toEqual([])
  })
})

describe("backfilling history", () => {
  test("writes every completed response through the resolved layout", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    await db.insert(answers).values({
      submissionId: s.submissionId,
      fieldId,
      type: "short_text",
      question: "Full name",
      value: "Ada",
    })
    // The owner put a column of their own first, so ours all sit one to the right.
    tags = [rowTag("header", 0), colTag("id", 1), colTag("ts", 2), colTag(`f:${fieldId}`, 3)]
    gridRows = [["Notes", "Submission ID", "Submitted at", "Full name"]]
    const conn = await googleConn(s.workspaceId)
    const config = await storedConfig(s.formId)

    const written = await backfillFormSheet(conn, config as never, s.formId)

    expect(written).toBe(1)
    expect(appended[0].cells).toEqual([null, s.submissionId, "2026-09-22T08:00:00.000Z", "Ada"])
  })

  test("skips a response whose row is already in the sheet", async () => {
    const fieldId = randomUUID()
    const s = await seed({ columns: [{ fieldId, label: "Full name" }] })
    tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag(`f:${fieldId}`, 2)]
    gridRows = [["Submission ID", "Submitted at", "Full name"]]
    idColumnValues = ["Submission ID", s.submissionId]
    const conn = await googleConn(s.workspaceId)
    const config = await storedConfig(s.formId)

    expect(await backfillFormSheet(conn, config as never, s.formId)).toBe(0)
    expect(appended).toEqual([])
  })
})
