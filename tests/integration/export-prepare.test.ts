/**
 * The dialog's server half: is this export servable, and where from.
 *
 * The dialog cannot answer either question — only the server knows the row
 * count, and the ceiling differs by format — so an oversized request has to
 * come back as a sentence rather than as a 413 the browser turns into a broken
 * download.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { db } from "@/lib/db"
import { answers, formFields, forms, submissions, workspaces } from "@/lib/db/schema"

const session = vi.hoisted(() => ({ workspaceId: null as string | null }))
vi.mock("@/lib/auth/session", () => ({
  getDefaultWorkspace: async () =>
    session.workspaceId
      ? { id: session.workspaceId, name: "T", slug: "t", plan: "free", role: "owner", logoUrl: null }
      : null,
}))

/**
 * The row count is overridden rather than spied on.
 *
 * vi.spyOn over an ES module namespace mutates a live binding and has to be
 * restored, which makes the outcome depend on test order — it produced a count
 * of zero in a test that never touched the spy. This wrapper is installed once,
 * before anything imports the module, and reads a plain variable.
 */
const counts = vi.hoisted(() => ({ override: null as number | null }))
vi.mock("@/lib/submissions/export-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/submissions/export-query")>()
  return {
    ...actual,
    countExportRows: async (formId: string, spec: never) =>
      counts.override ?? actual.countExportRows(formId, spec),
  }
})

const { prepareExport } = await import("@/lib/actions/exports")
const { decodeSpec, exportSpecSchema, syncCeilingFor } = await import(
  "@/lib/submissions/export-spec"
)

let seq = 0
async function seed(rows: number) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS p ${seq}`, slug: `ws-p-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Roles", publicId: `p${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [name] = await db
    .insert(formFields)
    .values([{ formId: form.id, type: "short_text" as const, label: "Name", position: 0 }])
    .returning({ id: formFields.id })
  for (let i = 0; i < rows; i++) {
    const [sub] = await db
      .insert(submissions)
      .values({ formId: form.id, workspaceId: ws.id, status: "completed", completedAt: new Date() })
      .returning({ id: submissions.id })
    await db
      .insert(answers)
      .values({ submissionId: sub.id, fieldId: name.id, question: "Name", type: "short_text", value: `P${i}` })
  }
  return { workspaceId: ws.id, formId: form.id, nameId: name.id }
}

beforeEach(() => {
  session.workspaceId = null
  counts.override = null
})

describe("prepareExport", () => {
  test("returns a download URL carrying the exact spec it was given", async () => {
    const f = await seed(2)
    session.workspaceId = f.workspaceId
    const spec = exportSpecSchema.parse({
      format: "xlsx",
      columns: { meta: ["submissionId", "submitted"], fields: [f.nameId] },
      scope: { limit: 1, order: "newest" },
      timezone: "Asia/Karachi",
    })

    const res = await prepareExport(f.formId, spec)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.rowCount).toBe(2)
    expect(res.url.startsWith(`/api/forms/${f.formId}/export?spec=`)).toBe(true)
    // Round-tripped, so what the dialog chose is what the route will serve.
    expect(decodeSpec(new URL(res.url, "http://x").searchParams.get("spec")!)).toEqual(spec)
  })

  test("an oversized CSV is refused with the count and the limit, not a 413", async () => {
    const f = await seed(1)
    session.workspaceId = f.workspaceId
    // Faked rather than seeded: proving the refusal does not require inserting
    // five thousand responses.
    counts.override = syncCeilingFor("csv") + 1

    const res = await prepareExport(f.formId, exportSpecSchema.parse({}))
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toContain("Too many responses")
    expect(res.error).toContain(syncCeilingFor("csv").toLocaleString())
  })

  test("an oversized spreadsheet is told to use CSV, which has the higher ceiling", async () => {
    const f = await seed(1)
    session.workspaceId = f.workspaceId
    counts.override = syncCeilingFor("xlsx") + 1

    const res = await prepareExport(f.formId, exportSpecSchema.parse({ format: "xlsx" }))
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toContain("Export as CSV")
  })

  test("another tenant's form is not found", async () => {
    const mine = await seed(1)
    const theirs = await seed(1)
    session.workspaceId = mine.workspaceId
    expect(await prepareExport(theirs.formId, exportSpecSchema.parse({}))).toEqual({
      success: false,
      error: "Form not found",
    })
  })

  test("a caller with no workspace gets nothing", async () => {
    const f = await seed(1)
    session.workspaceId = null
    expect((await prepareExport(f.formId, exportSpecSchema.parse({}))).success).toBe(false)
  })

  test("a nonsense spec is rejected rather than silently defaulted", async () => {
    const f = await seed(1)
    session.workspaceId = f.workspaceId
    const res = await prepareExport(f.formId, { format: "pdf" } as never)
    expect(res).toEqual({ success: false, error: "That export request is not valid" })
  })
})
