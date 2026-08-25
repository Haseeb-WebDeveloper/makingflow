/**
 * Regression: a REQUIRED field hidden by conditional logic must not block
 * submission.
 *
 * Both runtimes build the answer payload with `isFieldVisible`, so a hidden
 * field is never sent. `submitForm` used to enforce `required` across every
 * field regardless of logic, which rejected the submission with
 * "Please answer: <hidden question>" — a question the respondent could not see
 * and had no way to answer. The form was permanently unsubmittable on that
 * branch.
 *
 * The pet example below is the exact shape used in the AI form-builder prompt,
 * so AI-generated forms hit this too.
 */
import { describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaces, forms, formFields, submissions, answers } from "@/lib/db/schema"
import type { FieldLogic } from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"

let seq = 0

/**
 * "Do you have a pet?" (yes_no, required)
 *   → "Pet's name" (short_text, REQUIRED, shown only when the answer is Yes)
 */
async function seedConditionalForm() {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS cond ${seq}`, slug: `ws-cond-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Pet survey",
      publicId: `cond${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
      renderMode: "classic",
    })
    .returning({ id: forms.id, publicId: forms.publicId })

  const [trigger] = await db
    .insert(formFields)
    .values({
      formId: form.id,
      type: "yes_no",
      label: "Do you have a pet?",
      required: true,
      position: 0,
    })
    .returning({ id: formFields.id })

  const logic: FieldLogic = {
    action: "show",
    match: "all",
    source: "manual",
    conditions: [{ fieldId: trigger.id, operator: "equals", value: "Yes" }],
  }

  const [dependent] = await db
    .insert(formFields)
    .values({
      formId: form.id,
      type: "short_text",
      label: "Pet's name",
      required: true,
      position: 1,
      logic,
    })
    .returning({ id: formFields.id })

  return { publicId: form.publicId, formId: form.id, triggerId: trigger.id, dependentId: dependent.id }
}

describe("submitForm — required fields behind conditional logic", () => {
  test("a hidden required field does not block submission", async () => {
    const f = await seedConditionalForm()

    // Answering "No" hides "Pet's name", so the client omits it entirely.
    const res = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.triggerId, value: "No" }],
    })

    expect(res.success).toBe(true)

    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("completed")

    // Only the visible answer is stored — no placeholder for the hidden field.
    const stored = await db.select().from(answers).where(eq(answers.submissionId, rows[0].id))
    expect(stored).toHaveLength(1)
    expect(stored[0].fieldId).toBe(f.triggerId)
  })

  test("a VISIBLE required field still blocks submission", async () => {
    const f = await seedConditionalForm()

    // "Yes" reveals "Pet's name"; omitting it must still be rejected —
    // the fix must not turn required-enforcement off wholesale.
    const res = await submitForm({
      publicId: f.publicId,
      answers: [{ fieldId: f.triggerId, value: "Yes" }],
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain("Pet's name")

    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    expect(rows).toHaveLength(0)
  })

  test("a required field with no logic still blocks submission", async () => {
    const f = await seedConditionalForm()

    // The trigger itself is required and unconditional.
    const res = await submitForm({ publicId: f.publicId, answers: [] })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain("Do you have a pet?")
  })

  test("answering the branch through records both fields", async () => {
    const f = await seedConditionalForm()

    const res = await submitForm({
      publicId: f.publicId,
      answers: [
        { fieldId: f.triggerId, value: "Yes" },
        { fieldId: f.dependentId, value: "Rex" },
      ],
    })

    expect(res.success).toBe(true)

    const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
    const stored = await db.select().from(answers).where(eq(answers.submissionId, rows[0].id))
    expect(stored).toHaveLength(2)
    expect(stored.map((a) => a.fieldId).sort()).toEqual([f.triggerId, f.dependentId].sort())
  })
})
