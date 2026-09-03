/**
 * Regression: an "Other" answer must be accepted by the server.
 *
 * A choice field with `config.allowOther` renders a free-text box whose typed
 * value IS the stored answer — not a marker like "Other: blue", and not a
 * separate field (see OtherChoice in field-control.tsx). The client validator
 * never checks option membership, but `submitForm` did, unconditionally, in
 * classic mode. So the one thing an Other box exists to produce — a value that
 * is deliberately NOT one of the listed labels — was rejected with
 * "Invalid option for …", and the form could not be submitted at all by anyone
 * who used it. Both the builder toggle and the Tally importer turn this on.
 */
import { describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaces, forms, formFields, submissions, answers } from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"

let seq = 0

type ChoiceType = "multiple_choice" | "dropdown" | "multi_select" | "checkboxes"

async function seedChoiceForm(type: ChoiceType, allowOther: boolean) {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS other ${seq}`, slug: `ws-other-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Colour survey",
      publicId: `oth${seq}${Math.floor(Date.now() % 1e6)}`,
      status: "published",
      renderMode: "classic",
    })
    .returning({ id: forms.id, publicId: forms.publicId })

  const [field] = await db
    .insert(formFields)
    .values({
      formId: form.id,
      type,
      label: "Favourite colour",
      position: 0,
      options: [
        { id: "o1", label: "Red" },
        { id: "o2", label: "Blue" },
      ],
      config: allowOther ? { allowOther: true } : {},
    })
    .returning({ id: formFields.id })

  return { publicId: form.publicId, formId: form.id, fieldId: field.id }
}

const SINGLE: ChoiceType[] = ["multiple_choice", "dropdown"]
const MULTI: ChoiceType[] = ["multi_select", "checkboxes"]

describe("submitForm — Other option", () => {
  for (const type of SINGLE) {
    test(`${type}: free text is accepted when allowOther is on`, async () => {
      const f = await seedChoiceForm(type, true)

      const res = await submitForm({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: "Chartreuse" }],
      })

      expect(res.success).toBe(true)
      const [row] = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
      const stored = await db.select().from(answers).where(eq(answers.submissionId, row.id))
      // Stored verbatim — same shape as any listed choice.
      expect(stored[0].value).toBe("Chartreuse")
    })

    test(`${type}: free text is still rejected when allowOther is off`, async () => {
      const f = await seedChoiceForm(type, false)

      const res = await submitForm({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: "Chartreuse" }],
      })

      expect(res.success).toBe(false)
      if (!res.success) expect(res.error).toContain("Favourite colour")
      const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
      expect(rows).toHaveLength(0)
    })

    test(`${type}: a listed option is accepted either way`, async () => {
      const f = await seedChoiceForm(type, false)
      const res = await submitForm({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: "Blue" }],
      })
      expect(res.success).toBe(true)
    })
  }

  for (const type of MULTI) {
    test(`${type}: listed options plus one Other value is accepted`, async () => {
      const f = await seedChoiceForm(type, true)

      const res = await submitForm({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: ["Red", "Chartreuse"] }],
      })

      expect(res.success).toBe(true)
      const [row] = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
      const stored = await db.select().from(answers).where(eq(answers.submissionId, row.id))
      expect(stored[0].value).toEqual(["Red", "Chartreuse"])
    })

    test(`${type}: a SECOND off-list value is rejected even with allowOther`, async () => {
      const f = await seedChoiceForm(type, true)

      // The runtime can only ever produce one Other value — the single text box.
      // Two means the payload was crafted, so membership still applies.
      const res = await submitForm({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: ["Chartreuse", "Puce"] }],
      })

      expect(res.success).toBe(false)
      const rows = await db.select().from(submissions).where(eq(submissions.formId, f.formId))
      expect(rows).toHaveLength(0)
    })

    test(`${type}: off-list value is rejected when allowOther is off`, async () => {
      const f = await seedChoiceForm(type, false)

      const res = await submitForm({
        publicId: f.publicId,
        answers: [{ fieldId: f.fieldId, value: ["Red", "Chartreuse"] }],
      })

      expect(res.success).toBe(false)
    })
  }
})
