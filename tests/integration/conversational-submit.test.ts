import { describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaces, forms, formFields, submissions, answers } from "@/lib/db/schema"
import { submitForm } from "@/lib/actions/submissions"

let seq = 0
async function seedForm(renderMode: "classic" | "conversational") {
  seq += 1
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS ${seq}`, slug: `ws-${seq}-${Date.now()}` })
    .returning({ id: workspaces.id })

  const publicId = `pub${seq}${Math.floor(Date.now() % 1e6)}`
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: ws.id,
      title: "Feedback",
      publicId,
      status: "published",
      renderMode,
      aiEnabled: renderMode === "conversational",
    })
    .returning({ id: forms.id, publicId: forms.publicId })

  const [name] = await db
    .insert(formFields)
    .values({ formId: form.id, type: "short_text", label: "Name", required: true, position: 0 })
    .returning({ id: formFields.id })
  const [rating] = await db
    .insert(formFields)
    .values({ formId: form.id, type: "rating", label: "Rating", required: false, position: 1 })
    .returning({ id: formFields.id })

  return { workspaceId: ws.id, publicId: form.publicId, nameId: name.id, ratingId: rating.id }
}

describe("submitForm — conversational mode", () => {
  test("records mode, language, originals, and AI follow-ups (NULL fieldId)", async () => {
    const f = await seedForm("conversational")

    const res = await submitForm({
      publicId: f.publicId,
      language: "it",
      answers: [
        { fieldId: f.nameId, value: "Marco", originalValue: "Marco", originalLanguage: "it" },
        { fieldId: f.ratingId, value: 4 },
        {
          fieldId: null,
          value: "Perché il servizio era ottimo",
          isAiFollowUp: true,
          question: "Why did you give 4 stars?",
          type: "long_text",
        },
        {
          fieldId: null,
          value: "Niente in particolare",
          isAiFollowUp: true,
          question: "Anything we could improve?",
          type: "long_text",
        },
      ],
    })
    expect(res).toEqual({ success: true })

    const subs = await db.select().from(submissions)
    expect(subs).toHaveLength(1)
    expect(subs[0].mode).toBe("conversational")
    expect(subs[0].language).toBe("it")
    expect(subs[0].status).toBe("completed")

    const rows = await db.select().from(answers).where(eq(answers.submissionId, subs[0].id))
    // 2 field answers + 2 follow-ups, all persisted (NULLs are distinct under
    // the unique (submissionId, fieldId) index).
    expect(rows).toHaveLength(4)

    const followUps = rows.filter((r) => r.isAiFollowUp)
    expect(followUps).toHaveLength(2)
    for (const fu of followUps) {
      expect(fu.fieldId).toBeNull()
      expect(fu.question.length).toBeGreaterThan(0)
      expect(fu.type).toBe("long_text")
    }

    const nameRow = rows.find((r) => r.fieldId === f.nameId)
    expect(nameRow?.isAiFollowUp).toBe(false)
    expect(nameRow?.originalLanguage).toBe("it")
  })
})

describe("submitForm — classic mode regression", () => {
  test("classic form records mode=classic and no follow-ups", async () => {
    const f = await seedForm("classic")
    const res = await submitForm({
      publicId: f.publicId,
      answers: [
        { fieldId: f.nameId, value: "Jane" },
        { fieldId: f.ratingId, value: 5 },
      ],
    })
    expect(res).toEqual({ success: true })

    const subs = await db.select().from(submissions)
    expect(subs).toHaveLength(1)
    expect(subs[0].mode).toBe("classic")
    expect(subs[0].language).toBeNull()

    const rows = await db.select().from(answers).where(eq(answers.submissionId, subs[0].id))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.isAiFollowUp === false)).toBe(true)
  })
})
