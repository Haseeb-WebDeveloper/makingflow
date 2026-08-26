/**
 * Two regressions around the form-detail "Ask AI" sheet.
 *
 * 1. COUNTS. `getFormSubmissions` caps its result (100 rows for the assistant),
 *    and the insights route reported `rows.length` as the submission total — so
 *    a form with thousands of responses was told it had exactly the page size.
 *    "How many responses so far?" is one of the sheet's three suggestion chips,
 *    so this was the most likely first question anyone asked.
 *
 * 2. THREAD SEPARATION. The builder conversation (about editing the form) and
 *    the insights conversation (about its responses) share one table, kept
 *    apart by `surface`. If they leaked into each other the model would read
 *    one thread as context for the other.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { db } from "@/lib/db"
import { users, workspaces, forms, formFields, submissions } from "@/lib/db/schema"

// The data layer resolves the caller's workspace from the session cookie, which
// integration tests have no scope for. Swap in a holder we can point at a
// different tenant mid-test.
const session = vi.hoisted(() => ({
  workspace: null as { id: string } | null,
  user: null as { id: string } | null,
}))

vi.mock("@/lib/auth/session", () => ({
  getDefaultWorkspace: async () => session.workspace,
  getOptionalUser: async () => session.user,
  getRequiredUser: async () => {
    if (!session.user) throw new Error("not signed in")
    return session.user
  },
}))

const { getFormSubmissions, getFormSubmissionCounts } = await import("@/lib/data/forms")
const { getFormChat } = await import("@/lib/data/form-chat")
const { appendFormChatMessage } = await import("@/lib/actions/form-chat")

const COMPLETED = 150
const PARTIAL = 7
const SAMPLE_LIMIT = 100 // MAX_ROWS in src/app/api/ai/insights/route.ts

let seq = 0

async function seedFormWithSubmissions() {
  seq += 1
  const userId = crypto.randomUUID()
  await db.insert(users).values({ id: userId, email: `ana-${seq}-${Date.now()}@example.com`, name: "Ana" })

  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS ai ${seq}`, slug: `ws-ai-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Feedback",
      publicId: `ai${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
    })
    .returning({ id: forms.id })

  await db
    .insert(formFields)
    .values({ formId: form.id, type: "short_text", label: "Your name", position: 0 })

  const rows = [
    ...Array.from({ length: COMPLETED }, () => ({
      formId: form.id,
      workspaceId: ws.id,
      status: "completed" as const,
    })),
    ...Array.from({ length: PARTIAL }, () => ({
      formId: form.id,
      workspaceId: ws.id,
      status: "partial" as const,
    })),
  ]
  await db.insert(submissions).values(rows)

  session.workspace = { id: ws.id }
  session.user = { id: userId }
  return { formId: form.id, workspaceId: ws.id, userId }
}

beforeEach(() => {
  session.workspace = null
  session.user = null
})

describe("submission counts feeding the AI analyst", () => {
  test("the real total is independent of the row limit", async () => {
    const f = await seedFormWithSubmissions()

    const data = await getFormSubmissions(f.formId, SAMPLE_LIMIT)
    const counts = await getFormSubmissionCounts(f.formId, f.workspaceId)

    // The sample is capped...
    expect(data?.rows).toHaveLength(SAMPLE_LIMIT)
    // ...but the totals are not. This is the regression: reporting rows.length
    // as the total would have said 100 instead of 150.
    expect(counts).toEqual({ completed: COMPLETED, partial: PARTIAL })
    expect(counts!.completed).toBeGreaterThan(data!.rows.length)
  })

  test("partials are counted but never sampled", async () => {
    const f = await seedFormWithSubmissions()

    // getFormSubmissions only returns completed rows, so a drop-off question
    // can't be answered from the sample — the count is the only source.
    const data = await getFormSubmissions(f.formId, 500)
    const counts = await getFormSubmissionCounts(f.formId, f.workspaceId)

    expect(data?.rows).toHaveLength(COMPLETED)
    expect(counts?.partial).toBe(PARTIAL)
  })

  test("counts are refused for a form in another workspace", async () => {
    const f = await seedFormWithSubmissions()
    const [other] = await db
      .insert(workspaces)
      .values({ name: "Intruder", slug: `intruder-${Date.now()}` })
      .returning({ id: workspaces.id })

    expect(await getFormSubmissionCounts(f.formId, other.id)).toBeNull()
  })
})

describe("builder and insights threads", () => {
  test("each surface reads back only its own turns, in order", async () => {
    const f = await seedFormWithSubmissions()

    await appendFormChatMessage({ formId: f.formId, role: "user", text: "Add an email field" })
    await appendFormChatMessage({ formId: f.formId, role: "assistant", text: "Added it." })
    await appendFormChatMessage({
      formId: f.formId,
      surface: "insights",
      role: "user",
      text: "How many responses?",
    })
    await appendFormChatMessage({
      formId: f.formId,
      surface: "insights",
      role: "assistant",
      text: "150 completed.",
    })

    const builder = await getFormChat(f.formId, "builder")
    const insights = await getFormChat(f.formId, "insights")

    expect(builder.map((m) => m.text)).toEqual(["Add an email field", "Added it."])
    expect(insights.map((m) => m.text)).toEqual(["How many responses?", "150 completed."])

    // A question must never read back before its answer.
    expect(insights.map((m) => m.role)).toEqual(["user", "assistant"])
  })

  test("the default surface is the builder thread", async () => {
    const f = await seedFormWithSubmissions()
    await appendFormChatMessage({ formId: f.formId, role: "user", text: "Make it shorter" })

    expect(await getFormChat(f.formId, "builder")).toHaveLength(1)
    expect(await getFormChat(f.formId, "insights")).toHaveLength(0)
  })

  test("a user turn is attributed, an assistant turn is not", async () => {
    const f = await seedFormWithSubmissions()
    await appendFormChatMessage({
      formId: f.formId,
      surface: "insights",
      role: "user",
      text: "Summarize these",
    })
    await appendFormChatMessage({
      formId: f.formId,
      surface: "insights",
      role: "assistant",
      text: "Mostly positive.",
    })

    const [question, answer] = await getFormChat(f.formId, "insights")
    expect(question.authorId).toBe(f.userId)
    expect(question.authorName).toBe("Ana")
    expect(answer.authorId).toBeNull()
  })

  test("another workspace sees nothing and can write nothing", async () => {
    const f = await seedFormWithSubmissions()
    await appendFormChatMessage({
      formId: f.formId,
      surface: "insights",
      role: "user",
      text: "Private question",
    })

    const [other] = await db
      .insert(workspaces)
      .values({ name: "Intruder", slug: `intruder-${Date.now()}` })
      .returning({ id: workspaces.id })
    session.workspace = { id: other.id }

    expect(await getFormChat(f.formId, "insights")).toEqual([])

    const res = await appendFormChatMessage({
      formId: f.formId,
      surface: "insights",
      role: "user",
      text: "Injected",
    })
    expect(res.success).toBe(false)

    // And the owner's thread is untouched.
    session.workspace = { id: f.workspaceId }
    expect(await getFormChat(f.formId, "insights")).toHaveLength(1)
  })
})
