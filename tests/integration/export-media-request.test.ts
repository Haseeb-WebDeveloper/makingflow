/**
 * Asking for a ZIP of every uploaded file.
 *
 * Cloudinary is stubbed — the archive call itself is one signed POST and is
 * proved by hand against the real account. What matters here is that the action
 * is workspace-scoped, that it archives exactly the rows the scope selected,
 * and that a form with no files says so rather than handing back an empty zip.
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

const archiveCalls = vi.hoisted(() => [] as { resourceType: string; publicIds: string[] }[])
vi.mock("@/lib/submissions/export-media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/submissions/export-media")>()
  return {
    ...actual,
    // Only the outbound HTTP call is faked; asset collection, grouping and
    // entry naming are the real implementations.
    buildMediaArchives: vi.fn(async (source: never, now: Date) => {
      const src = source as unknown as { rows: AsyncGenerator<{ files: { storageKey?: string; mime?: string }[] }> }
      const assets = await actual.collectAssets(src as never)
      const groups = actual.groupByResourceType(assets)
      for (const g of groups) archiveCalls.push({ resourceType: g.resourceType, publicIds: g.publicIds })
      return {
        archives: groups.map((g, i) => ({
          name: `roles-files-${now.toISOString().slice(0, 10)}${groups.length > 1 ? `-${i + 1}` : ""}.zip`,
          url: `https://res.test/archive-${i}.zip`,
          fileCount: g.publicIds.length,
          requested: g.publicIds.length,
          bytes: 1024,
        })),
        fileCount: assets.length,
        rowCount: 0,
      }
    }),
  }
})

const { requestMediaArchive } = await import("@/lib/actions/exports")
const { exportSpecSchema } = await import("@/lib/submissions/export-spec")

let seq = 0
async function seed() {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS m ${seq}`, slug: `ws-m-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Roles", publicId: `m${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [city, cv] = await db
    .insert(formFields)
    .values([
      { formId: form.id, type: "short_text" as const, label: "City", position: 0 },
      { formId: form.id, type: "file_upload" as const, label: "CV", position: 1 },
    ])
    .returning({ id: formFields.id })

  async function add(city_: string, file: { key: string; mime: string; name: string } | null) {
    const [sub] = await db
      .insert(submissions)
      .values({ formId: form.id, workspaceId: ws.id, status: "completed", completedAt: new Date() })
      .returning({ id: submissions.id })
    await db
      .insert(answers)
      .values({ submissionId: sub.id, fieldId: city.id, question: "City", type: "short_text", value: city_ })
    if (file) {
      await db.insert(answers).values({
        submissionId: sub.id,
        fieldId: cv.id,
        question: "CV",
        type: "file_upload",
        value: {
          files: [
            {
              storageKey: `makingflow/submissions/${file.key}`,
              url: `https://res.cloudinary.com/demo/raw/upload/v17/makingflow/submissions/${file.key}`,
              name: file.name,
              mime: file.mime,
            },
          ],
        } as never,
      })
    }
    return sub.id
  }

  return { workspaceId: ws.id, formId: form.id, cityId: city.id, add }
}

beforeEach(() => {
  session.workspaceId = null
  archiveCalls.length = 0
})

describe("requestMediaArchive", () => {
  test("archives every uploaded file in the form", async () => {
    const f = await seed()
    await f.add("Lahore", { key: "aaa", mime: "application/pdf", name: "cv.pdf" })
    await f.add("Karachi", { key: "bbb", mime: "application/pdf", name: "resume.pdf" })
    session.workspaceId = f.workspaceId

    const res = await requestMediaArchive(f.formId, exportSpecSchema.parse({ files: "zip-only" }))
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.fileCount).toBe(2)
    expect(res.archives).toHaveLength(1)
    expect(res.archives[0].url).toBe("https://res.test/archive-0.zip")
    expect(archiveCalls[0].publicIds).toEqual([
      "makingflow/submissions/aaa",
      "makingflow/submissions/bbb",
    ])
  })

  test("a filtered scope archives only the matching submissions' files", async () => {
    const f = await seed()
    await f.add("Lahore", { key: "aaa", mime: "application/pdf", name: "cv.pdf" })
    await f.add("Karachi", { key: "bbb", mime: "application/pdf", name: "cv.pdf" })
    session.workspaceId = f.workspaceId

    const res = await requestMediaArchive(
      f.formId,
      exportSpecSchema.parse({
        files: "zip-only",
        scope: { filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }] },
      }),
    )
    expect(res.success && res.fileCount).toBe(1)
    expect(archiveCalls[0].publicIds).toEqual(["makingflow/submissions/bbb"])
  })

  test("mixed file types produce one archive per Cloudinary resource type", async () => {
    const f = await seed()
    await f.add("Lahore", { key: "aaa", mime: "application/pdf", name: "cv.pdf" })
    await f.add("Karachi", { key: "bbb", mime: "image/png", name: "id.png" })
    session.workspaceId = f.workspaceId

    const res = await requestMediaArchive(f.formId, exportSpecSchema.parse({ files: "zip-only" }))
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.archives).toHaveLength(2)
    expect(archiveCalls.map((c) => c.resourceType)).toEqual(["raw", "image"])
  })

  test("a form with no uploads says so instead of handing back an empty zip", async () => {
    const f = await seed()
    await f.add("Lahore", null)
    session.workspaceId = f.workspaceId

    const res = await requestMediaArchive(f.formId, exportSpecSchema.parse({ files: "zip-only" }))
    expect(res).toEqual({ success: false, error: "These responses have no uploaded files." })
  })

  test("another tenant's form is not found", async () => {
    const mine = await seed()
    const theirs = await seed()
    await theirs.add("Lahore", { key: "aaa", mime: "application/pdf", name: "cv.pdf" })
    session.workspaceId = mine.workspaceId

    const res = await requestMediaArchive(theirs.formId, exportSpecSchema.parse({ files: "zip-only" }))
    expect(res).toEqual({ success: false, error: "Form not found" })
  })

  test("a caller with no workspace gets nothing", async () => {
    const f = await seed()
    session.workspaceId = null
    const res = await requestMediaArchive(f.formId, exportSpecSchema.parse({ files: "zip-only" }))
    expect(res.success).toBe(false)
  })
})
