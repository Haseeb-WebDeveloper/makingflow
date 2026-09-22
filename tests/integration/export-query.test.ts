/**
 * The scope half of an export: which rows, in which order, with which answers
 * attached. Filters run in JS over each page (D2), so these tests are the proof
 * that the export agrees with the table the owner was looking at.
 */
import { describe, expect, test } from "vitest"
import { db } from "@/lib/db"
import { answers, formFields, forms, submissions, workspaces } from "@/lib/db/schema"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import { countExportRows, openExport } from "@/lib/submissions/export-query"

let seq = 0

async function seed() {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS q ${seq}`, slug: `ws-q-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })
  const [form] = await db
    .insert(forms)
    .values({ workspaceId: ws.id, title: "Roles", publicId: `q${seq}${Date.now() % 1e6}`, status: "published" })
    .returning({ id: forms.id })
  const [city, gone] = await db
    .insert(formFields)
    .values([
      { formId: form.id, type: "short_text" as const, label: "City", position: 0 },
      { formId: form.id, type: "short_text" as const, label: "Old question", position: 1, deletedAt: new Date() },
    ])
    .returning({ id: formFields.id })

  async function add(city_: string, opts: { status?: "partial" | "completed"; at?: Date; followUps?: number } = {}) {
    const at = opts.at ?? new Date("2026-09-10T00:00:00.000Z")
    const [sub] = await db
      .insert(submissions)
      .values({
        formId: form.id,
        workspaceId: ws.id,
        status: opts.status ?? "completed",
        createdAt: at,
        completedAt: opts.status === "partial" ? null : at,
      })
      .returning({ id: submissions.id })
    await db.insert(answers).values([
      { submissionId: sub.id, fieldId: city.id, question: "City", type: "short_text", value: city_ },
      { submissionId: sub.id, fieldId: gone.id, question: "Old question", type: "short_text", value: "legacy" },
    ])
    for (let i = 0; i < (opts.followUps ?? 0); i++) {
      await db.insert(answers).values({
        submissionId: sub.id,
        fieldId: null,
        isAiFollowUp: true,
        question: `Follow-up ${i}`,
        type: "short_text",
        value: `answer ${i}`,
      })
    }
    return sub.id
  }

  return { workspaceId: ws.id, formId: form.id, cityId: city.id, add }
}

const collect = async (source: NonNullable<Awaited<ReturnType<typeof openExport>>>) => {
  const out = []
  for await (const row of source.rows) out.push(row)
  return out
}

describe("openExport", () => {
  test("refuses a form in another workspace", async () => {
    const a = await seed()
    const b = await seed()
    expect(await openExport(a.formId, b.workspaceId, exportSpecSchema.parse({}))).toBeNull()
  })

  test("completed only by default, partials on request", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi", { status: "partial" })

    const done = await openExport(f.formId, f.workspaceId, exportSpecSchema.parse({}))
    expect((await collect(done!)).length).toBe(1)

    const all = await openExport(f.formId, f.workspaceId, exportSpecSchema.parse({ scope: { status: "all" } }))
    expect((await collect(all!)).length).toBe(2)
  })

  test("a field filter selects the same rows the table would", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi")
    const spec = exportSpecSchema.parse({
      scope: { filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }] },
    })
    const source = await openExport(f.formId, f.workspaceId, spec)
    const rows = await collect(source!)
    expect(rows.map((r) => r.values[f.cityId])).toEqual(["Karachi"])
  })

  test("search looks across every answer", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi")
    const spec = exportSpecSchema.parse({ scope: { search: "kara" } })
    expect((await collect((await openExport(f.formId, f.workspaceId, spec))!)).length).toBe(1)
  })

  test("a date range is inclusive at both ends", async () => {
    const f = await seed()
    await f.add("A", { at: new Date("2026-09-01T10:00:00.000Z") })
    await f.add("B", { at: new Date("2026-09-05T10:00:00.000Z") })
    await f.add("C", { at: new Date("2026-09-09T10:00:00.000Z") })
    const spec = exportSpecSchema.parse({ scope: { from: "2026-09-05", to: "2026-09-09" } })
    const rows = await collect((await openExport(f.formId, f.workspaceId, spec))!)
    expect(rows.map((r) => r.values[f.cityId])).toEqual(["B", "C"])
  })

  test("most-recent-N counts the rows that survived the filter", async () => {
    const f = await seed()
    await f.add("Lahore", { at: new Date("2026-09-01T00:00:00.000Z") })
    await f.add("Karachi", { at: new Date("2026-09-02T00:00:00.000Z") })
    await f.add("Karachi", { at: new Date("2026-09-03T00:00:00.000Z") })
    const spec = exportSpecSchema.parse({
      scope: {
        order: "newest",
        limit: 1,
        filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }],
      },
    })
    const rows = await collect((await openExport(f.formId, f.workspaceId, spec))!)
    expect(rows).toHaveLength(1)
    expect(rows[0].createdAt.toISOString()).toBe("2026-09-03T00:00:00.000Z")
  })

  test("answers to a removed question are recovered by their label, opt-in", async () => {
    const f = await seed()
    await f.add("Lahore")
    const off = await openExport(f.formId, f.workspaceId, exportSpecSchema.parse({}))
    expect(off!.sources.removedQuestions).toEqual([])

    const on = await openExport(
      f.formId,
      f.workspaceId,
      exportSpecSchema.parse({ columns: { removedQuestions: true } }),
    )
    expect(on!.sources.removedQuestions).toEqual(["Old question"])
    const rows = await collect(on!)
    expect(rows[0].removed["Old question"]).toBe("legacy")
  })

  test("the follow-up column count is the busiest submission in scope", async () => {
    const f = await seed()
    await f.add("Lahore", { followUps: 1 })
    await f.add("Karachi", { followUps: 3 })
    const spec = exportSpecSchema.parse({ columns: { aiFollowUps: true } })
    const source = await openExport(f.formId, f.workspaceId, spec)
    expect(source!.sources.followUpCount).toBe(3)
    const rows = await collect(source!)
    expect(rows.flatMap((r) => r.followUps).length).toBe(4)
  })

  test("the pre-flight count is the pre-filter scope, so it never under-counts", async () => {
    const f = await seed()
    await f.add("Lahore")
    await f.add("Karachi")
    const spec = exportSpecSchema.parse({
      scope: { filters: [{ fieldId: f.cityId, operator: "equals", value: "Karachi" }] },
    })
    expect(await countExportRows(f.formId, spec)).toBe(2)
  })
})
