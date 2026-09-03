/**
 * The CSV export route.
 *
 * The old export was built in the browser from whatever the responses table
 * held — and that table is capped at 200 rows, so a form with more responses
 * silently exported a slice of itself with no indication the rest existed.
 * This route streams every completed response instead, which makes three things
 * worth proving: it really does go past the cap, it stays workspace-scoped, and
 * respondent text can't come back as a live spreadsheet formula.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { db } from "@/lib/db"
import { workspaces, forms, formFields, submissions, answers } from "@/lib/db/schema"

// The route resolves the caller through the session helper; swap it for a
// controllable stand-in so the test can act as owner, as another tenant, or as
// nobody at all.
const session = vi.hoisted(() => ({ workspaceId: null as string | null }))
vi.mock("@/lib/auth/session", () => ({
  getDefaultWorkspace: async () =>
    session.workspaceId ? { id: session.workspaceId, name: "T", slug: "t", plan: "free", role: "owner", logoUrl: null } : null,
}))

const { GET } = await import("@/app/api/forms/[id]/export/route")

let seq = 0

async function seed(rowCount: number, extra?: { source?: string }) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS export ${seq}`, slug: `ws-export-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Job Application",
      publicId: `exp${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
    })
    .returning({ id: forms.id })

  const [name, note] = await db
    .insert(formFields)
    .values([
      { formId: form.id, type: "short_text" as const, label: "Name", position: 0 },
      { formId: form.id, type: "long_text" as const, label: "Notes", position: 1 },
      // A content block: it collects no answer, so it must NOT become a column.
      { formId: form.id, type: "heading" as const, label: "Section", position: 2 },
    ])
    .returning({ id: formFields.id })

  for (let i = 0; i < rowCount; i++) {
    const [sub] = await db
      .insert(submissions)
      .values({ formId: form.id, workspaceId: ws.id, status: "completed", completedAt: new Date() })
      .returning({ id: submissions.id })
    await db.insert(answers).values([
      { submissionId: sub.id, fieldId: name.id, question: "Name", type: "short_text", value: `Person ${i}` },
      {
        submissionId: sub.id,
        fieldId: note.id,
        question: "Notes",
        type: "long_text",
        value: i === 0 && extra?.source ? extra.source : `note ${i}`,
      },
    ])
  }

  // An abandoned draft must never appear in the export.
  await db.insert(submissions).values({ formId: form.id, workspaceId: ws.id, status: "partial" })

  return { workspaceId: ws.id, formId: form.id }
}

const exportCsv = async (formId: string) => {
  const res = await GET(new Request(`http://localhost/api/forms/${formId}/export`), {
    params: Promise.resolve({ id: formId }),
  })
  return { res, body: await res.text() }
}

beforeEach(() => {
  session.workspaceId = null
})

describe("GET /api/forms/[id]/export", () => {
  test("exports every completed response, well past the 200-row table cap", async () => {
    const f = await seed(250)
    session.workspaceId = f.workspaceId

    const { res, body } = await exportCsv(f.formId)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toContain("job-application-submissions.csv")

    const lines = body.trim().split("\n")
    // 1 header + 250 responses. The partial draft is excluded.
    expect(lines).toHaveLength(251)
    expect(lines[0]).toBe(`"Submitted","Name","Notes"`) // the heading block is not a column
    expect(body).toContain("Person 0")
    expect(body).toContain("Person 249")
  })

  test("neutralizes formulas so the owner's spreadsheet can't execute respondent text", async () => {
    const f = await seed(1, { source: `=HYPERLINK("http://evil.test","clickme")` })
    session.workspaceId = f.workspaceId

    const { body } = await exportCsv(f.formId)
    // Escaped with a leading apostrophe, and never as a bare `=`.
    expect(body).toContain(`"'=HYPERLINK(""http://evil.test"",""clickme"")"`)
    expect(body).not.toMatch(/,"=/)
  })

  test("refuses a caller with no workspace", async () => {
    const f = await seed(1)
    session.workspaceId = null
    const { res } = await exportCsv(f.formId)
    expect(res.status).toBe(401)
  })

  test("refuses a form belonging to another workspace", async () => {
    const mine = await seed(1)
    const theirs = await seed(1)
    session.workspaceId = mine.workspaceId

    const { res } = await exportCsv(theirs.formId)
    expect(res.status).toBe(404) // indistinguishable from "doesn't exist"
  })

  test("a form with no responses still exports a usable header", async () => {
    const f = await seed(0)
    session.workspaceId = f.workspaceId
    const { body } = await exportCsv(f.formId)
    expect(body.trim().split("\n")).toHaveLength(1)
    expect(body).toContain(`"Submitted","Name","Notes"`)
  })
})
