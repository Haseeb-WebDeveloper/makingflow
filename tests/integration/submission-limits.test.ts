/**
 * Submission caps and one-response-per-person under concurrency.
 *
 * Both rules used to be a COUNT(*) read followed by an unguarded insert, so N
 * simultaneous submits all observed the same under-limit count and all
 * committed — a form capped at 100 could accept 105. Enforcement now lives
 * where it can't be raced: an advisory lock around the re-count for the cap,
 * and a partial unique index for the respondent rule.
 */
import { describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaces, forms, formFields, submissions } from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"
import { isUniqueViolation } from "@/lib/db/errors"

let seq = 0

async function seedForm(opts: { submissionLimit?: number } = {}) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS limit ${seq}`, slug: `ws-limit-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Limited",
      publicId: `lim${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
      renderMode: "classic",
      submissionLimit: opts.submissionLimit ?? null,
    })
    .returning({ id: forms.id, publicId: forms.publicId })

  const [field] = await db
    .insert(formFields)
    .values({ formId: form.id, type: "short_text", label: "Name", position: 0 })
    .returning({ id: formFields.id })

  return { publicId: form.publicId, formId: form.id, fieldId: field.id }
}

const completedCount = async (formId: string) =>
  (
    await db
      .select()
      .from(submissions)
      .where(eq(submissions.formId, formId))
  ).filter((s) => s.status === "completed").length

describe("submitForm — submission cap", () => {
  test("concurrent submits cannot exceed a cap of 1", async () => {
    const f = await seedForm({ submissionLimit: 1 })

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        submitForm({
          publicId: f.publicId,
          answers: [{ fieldId: f.fieldId, value: `respondent ${i}` }],
        }),
      ),
    )

    expect(results.filter((r) => r.success)).toHaveLength(1)
    expect(await completedCount(f.formId)).toBe(1)
    // The rest get the closed message, not a generic failure.
    for (const r of results.filter((x) => !x.success)) {
      if (!r.success) expect(r.error).toBe("This form is closed.")
    }
  })

  test("concurrent submits cannot exceed a cap of 3", async () => {
    const f = await seedForm({ submissionLimit: 3 })

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        submitForm({
          publicId: f.publicId,
          answers: [{ fieldId: f.fieldId, value: `respondent ${i}` }],
        }),
      ),
    )

    expect(results.filter((r) => r.success)).toHaveLength(3)
    expect(await completedCount(f.formId)).toBe(3)
  })

  test("an uncapped form takes every submission", async () => {
    const f = await seedForm()

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        submitForm({
          publicId: f.publicId,
          answers: [{ fieldId: f.fieldId, value: `respondent ${i}` }],
        }),
      ),
    )

    expect(results.every((r) => r.success)).toBe(true)
    expect(await completedCount(f.formId)).toBe(6)
  })
})

describe("one response per person", () => {
  test("the unique index rejects a second completed response for one respondent", async () => {
    const f = await seedForm()
    const [{ id: workspaceId }] = await db
      .select({ id: forms.workspaceId })
      .from(forms)
      .where(eq(forms.id, f.formId))

    const row = {
      formId: f.formId,
      workspaceId,
      status: "completed" as const,
      respondentKey: "device-abc",
    }

    // submitForm derives respondentKey from request headers, which don't exist
    // in this context — so drive the constraint directly, which is the guarantee
    // the action now leans on.
    await db.insert(submissions).values(row)

    // Asserted through the same helper submitForm uses, so this breaks if the
    // error shape moves again. Drizzle wraps driver errors in a
    // DrizzleQueryError and hangs the PostgresError off `.cause`, so reading a
    // bare `err.code` silently never matches — which is precisely how this
    // check can look correct and do nothing.
    let caught: unknown
    try {
      await db.insert(submissions).values(row)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(isUniqueViolation(caught)).toBe(true)

    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(1)
  })

  test("partials and un-keyed rows are unconstrained", async () => {
    const f = await seedForm()
    const [{ id: workspaceId }] = await db
      .select({ id: forms.workspaceId })
      .from(forms)
      .where(eq(forms.id, f.formId))

    // Two drafts from the same device are normal — they're the same session
    // re-saving, or two abandoned attempts. Only completed rows are constrained.
    await db.insert(submissions).values([
      { formId: f.formId, workspaceId, status: "partial", respondentKey: "device-xyz" },
      { formId: f.formId, workspaceId, status: "partial", respondentKey: "device-xyz" },
      { formId: f.formId, workspaceId, status: "completed", respondentKey: null },
      { formId: f.formId, workspaceId, status: "completed", respondentKey: null },
    ])

    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(4)
  })
})
