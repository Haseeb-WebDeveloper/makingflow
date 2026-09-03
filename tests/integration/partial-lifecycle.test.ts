/**
 * The partial → completed lifecycle.
 *
 * There is exactly ONE `submissions` row per respondent session: it is born
 * `partial` on the first autosave and promoted in place by `submitForm`. The
 * regression guarded here is the duplicate twin: a save arriving after the
 * promotion (an in-flight autosave, or the `pagehide` flush that fires when the
 * success page unloads or a redirectUrl is followed) used to find no `partial`
 * row for the id it was given and INSERT a brand-new one holding the full
 * answer set. That row then scored as an abandon at the final question, putting
 * a phantom spike on every form's drop-off chart.
 */
import { describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaces, forms, formFields, submissions, answers } from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"
import { POST as partialPost, GET as partialGet } from "@/app/api/partial/route"
import { MAX_ANSWERS, MAX_VALUE_LEN } from "@/lib/submissions/limits"

let seq = 0

async function seedForm(overrides: { closesAt?: Date } = {}) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS partial ${seq}`, slug: `ws-partial-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Feedback",
      publicId: `par${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
      renderMode: "classic",
      closesAt: overrides.closesAt ?? null,
    })
    .returning({ id: forms.id, publicId: forms.publicId })

  const [field] = await db
    .insert(formFields)
    .values({ formId: form.id, type: "short_text", label: "Your name", position: 0 })
    .returning({ id: formFields.id })

  return { publicId: form.publicId, formId: form.id, fieldId: field.id }
}

function savePartial(body: unknown) {
  return partialPost(
    new Request("http://localhost/api/partial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

describe("/api/partial — draft lifecycle", () => {
  test("a draft is created, then promoted in place by submit", async () => {
    const f = await seedForm()

    const saved = await (
      await savePartial({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: "Ada" }],
      })
    ).json()
    expect(saved.submissionId).toBeTruthy()

    const drafts = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].status).toBe("partial")

    const res = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada Lovelace" }],
      submissionId: saved.submissionId,
    })
    expect(res.success).toBe(true)

    // Same row, flipped — not a second one.
    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(saved.submissionId)
    expect(rows[0].status).toBe("completed")
    expect(rows[0].completedAt).not.toBeNull()

    // Draft answers are replaced by the validated final set.
    const stored = await db.select().from(answers).where(eq(answers.submissionId, rows[0].id))
    expect(stored).toHaveLength(1)
    expect(stored[0].value).toBe("Ada Lovelace")
  })

  test("a save carrying an already-promoted id creates nothing", async () => {
    const f = await seedForm()

    const saved = await (
      await savePartial({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    ).json()
    await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.fieldId, value: "Ada" }],
      submissionId: saved.submissionId,
    })

    // This is the unload flush racing the promotion.
    const late = await (
      await savePartial({
        publicId: f.publicId,
        submissionId: saved.submissionId,
        answers: [{ fieldId: f.fieldId, value: "Ada" }],
      })
    ).json()
    expect(late.submissionId).toBeUndefined()

    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("completed")
  })

  test("a save carrying an unknown id creates nothing", async () => {
    const f = await seedForm()
    const res = await (
      await savePartial({
        publicId: f.publicId,
        submissionId: "00000000-0000-0000-0000-000000000000",
        answers: [{ fieldId: f.fieldId, value: "Ada" }],
      })
    ).json()

    expect(res.submissionId).toBeUndefined()
    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(0)
  })

  test("resume reads back the saved draft", async () => {
    const f = await seedForm()
    const saved = await (
      await savePartial({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    ).json()

    const url = `http://localhost/api/partial?publicId=${f.publicId}&submissionId=${saved.submissionId}`
    const body = await (await partialGet(new Request(url))).json()
    expect(body.values[f.fieldId]).toBe("Ada")
  })

  test("a closed form accepts no draft writes", async () => {
    const f = await seedForm({ closesAt: new Date(Date.now() - 60_000) })

    const res = await (
      await savePartial({ publicId: f.publicId, answers: [{ fieldId: f.fieldId, value: "Ada" }] })
    ).json()

    expect(res.submissionId).toBeUndefined()
    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(0)
  })
})

describe("/api/partial — input limits", () => {
  test("an over-long value is dropped, not stored", async () => {
    const f = await seedForm()

    const res = await (
      await savePartial({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: "x".repeat(MAX_VALUE_LEN + 1) }],
      })
    ).json()

    // Nothing acceptable was left, so no draft is opened at all.
    expect(res.submissionId).toBeUndefined()
    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(0)
  })

  test("an over-long answer list is refused outright", async () => {
    const f = await seedForm()

    const res = await (
      await savePartial({
        publicId: f.publicId,
        answers: Array.from({ length: MAX_ANSWERS + 1 }, () => ({
          fieldId: f.fieldId,
          value: "x",
        })),
      })
    ).json()

    expect(res.submissionId).toBeUndefined()
    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(0)
  })

  test("duplicate entries for one field collapse instead of aborting the save", async () => {
    const f = await seedForm()

    // Two rows for the same (submission, field) would violate
    // answers_submission_field_idx and roll back the whole draft.
    const res = await (
      await savePartial({
        publicId: f.publicId,
        answers: [
          { fieldId: f.fieldId, value: "first" },
          { fieldId: f.fieldId, value: "second" },
        ],
      })
    ).json()

    expect(res.submissionId).toBeTruthy()
    const stored = await db
      .select()
      .from(answers)
      .where(eq(answers.submissionId, res.submissionId))
    expect(stored).toHaveLength(1)
    expect(stored[0].value).toBe("second") // last wins
  })
})
