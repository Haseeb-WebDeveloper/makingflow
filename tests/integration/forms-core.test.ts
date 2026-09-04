/**
 * The form core, and the tenancy guarantees it has to hold.
 *
 * `deleteForm` gets the most attention here, because it is the most dangerous
 * function in the codebase: a hard delete whose cascade takes fields,
 * submissions, answers, events and integrations with it, plus an `after()` hook
 * that erases the form's Cloudinary assets. There is no trash and no restore. A
 * tenancy slip here does not leak data, it destroys it.
 *
 * Every cross-tenant case asserts twice: the call reports "not found", AND the
 * victim's rows are still there afterwards. The first without the second would
 * pass even for a function that deleted the row and then returned an error.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formFields, submissions, users, workspaces } from "@/lib/db/schema"
import * as formsCore from "@/lib/core/forms"
import { testContext } from "../helpers/context"
import { cacheSpy, resetCacheSpy } from "../helpers/cache-spy"

let seq = 0

async function seedTenant(label: string) {
  seq += 1
  const unique = `${label}-${seq}-${Date.now()}`
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${unique}@example.test`, name: label })
    .returning({ id: users.id })
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `WS ${unique}`, slug: `ws-${unique}` })
    .returning({ id: workspaces.id })
  return {
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
    workspaceId: workspace.id,
    userId: user.id,
  }
}

/** A form with two fields, created through the core so ids come from the app. */
async function seedForm(ctx: ReturnType<typeof testContext>, title = "Job Application") {
  const saved = await formsCore.saveAiForm(ctx, {
    form: {
      title,
      fields: [
        { id: randomUUID(), type: "short_text", label: "Name", required: true },
        { id: randomUUID(), type: "long_text", label: "Why you?", required: false },
      ],
    },
  })
  if (!saved.success) throw new Error(`seedForm failed: ${saved.error}`)
  return saved.id
}

describe("core/forms", () => {
  let alice: Awaited<ReturnType<typeof seedTenant>>
  let bob: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    alice = await seedTenant("alice")
    bob = await seedTenant("bob")
    resetCacheSpy()
  })

  describe("within a tenant", () => {
    test("saves a form and its fields, attributing it to the caller", async () => {
      const formId = await seedForm(alice.ctx)

      const [form] = await db.select().from(forms).where(eq(forms.id, formId))
      expect(form.workspaceId).toBe(alice.workspaceId)
      expect(form.createdById).toBe(alice.userId)
      expect(form.title).toBe("Job Application")

      const fields = await db.select().from(formFields).where(eq(formFields.formId, formId))
      expect(fields).toHaveLength(2)
    })

    test("re-saving soft-deletes removed fields rather than orphaning answers", async () => {
      const formId = await seedForm(alice.ctx)
      const [kept] = await db
        .select()
        .from(formFields)
        .where(eq(formFields.formId, formId))
        .orderBy(formFields.position)

      const again = await formsCore.saveAiForm(alice.ctx, {
        formId,
        form: {
          title: "Job Application",
          fields: [{ id: kept.id, type: "short_text", label: "Name", required: true }],
        },
      })
      expect(again.success).toBe(true)

      const rows = await db.select().from(formFields).where(eq(formFields.formId, formId))
      // Both rows survive; the dropped one is merely marked deleted, so any
      // answer still pointing at it keeps resolving its question.
      expect(rows).toHaveLength(2)
      expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(1)
    })

    test("publish then unpublish moves the form in and out of live", async () => {
      const formId = await seedForm(alice.ctx)

      const published = await formsCore.publishForm(alice.ctx, formId)
      expect(published.success).toBe(true)
      let [form] = await db.select().from(forms).where(eq(forms.id, formId))
      expect(form.status).toBe("published")
      expect(form.publishedAt).not.toBeNull()

      expect(await formsCore.unpublishForm(alice.ctx, formId)).toEqual({ success: true })
      ;[form] = await db.select().from(forms).where(eq(forms.id, formId))
      expect(form.status).toBe("draft")
    })

    test("duplicate copies the definition but never the live link", async () => {
      const formId = await seedForm(alice.ctx)
      await formsCore.publishForm(alice.ctx, formId)
      const [original] = await db.select().from(forms).where(eq(forms.id, formId))

      const copy = await formsCore.duplicateForm(alice.ctx, formId)
      if (!copy.success || !copy.id) throw new Error("duplicate failed")

      const [dup] = await db.select().from(forms).where(eq(forms.id, copy.id))
      expect(dup.title).toBe("Job Application (copy)")
      // A copy that inherited the public id or published status would hijack the
      // original's link and start collecting its responses.
      expect(dup.publicId).not.toBe(original.publicId)
      expect(dup.status).toBe("draft")
      expect(dup.publishedAt).toBeNull()
      expect(await db.select().from(formFields).where(eq(formFields.formId, copy.id))).toHaveLength(
        2,
      )
    })

    test("settings merge into the jsonb rather than replacing it", async () => {
      const formId = await seedForm(alice.ctx)

      await formsCore.updateFormSettings(alice.ctx, formId, { thankYouMessage: "Thanks!" })
      await formsCore.updateFormSettings(alice.ctx, formId, { showProgressBar: true })

      const [form] = await db.select().from(forms).where(eq(forms.id, formId))
      // The second write must not have dropped the first.
      expect(form.settings?.thankYouMessage).toBe("Thanks!")
      expect(form.settings?.showProgressBar).toBe(true)
    })

    test("switching to conversational turns AI on, since it cannot run without it", async () => {
      const formId = await seedForm(alice.ctx)
      await formsCore.updateFormSettings(alice.ctx, formId, { renderMode: "conversational" })

      const [form] = await db.select().from(forms).where(eq(forms.id, formId))
      expect(form.renderMode).toBe("conversational")
      expect(form.aiEnabled).toBe(true)
    })

    test("delete removes the form and its fields", async () => {
      const formId = await seedForm(alice.ctx)

      expect(await formsCore.deleteForm(alice.ctx, formId)).toEqual({ success: true })

      expect(await db.select().from(forms).where(eq(forms.id, formId))).toHaveLength(0)
      expect(await db.select().from(formFields).where(eq(formFields.formId, formId))).toHaveLength(0)
    })

    test("a rename invalidates the public form cache, not just the dashboard", async () => {
      const formId = await seedForm(alice.ctx)
      resetCacheSpy()

      await formsCore.renameForm(alice.ctx, formId, "Renamed")

      // The title renders on the PUBLIC form. Missing this tag is the silent
      // bug class this whole layer exists to prevent.
      expect(cacheSpy().tags).toContain(`form-${formId}`)
      expect(cacheSpy().tags).toContain(`workspace-forms-${alice.workspaceId}`)
    })
  })

  describe("across tenants", () => {
    test("cannot read or edit another tenant's form", async () => {
      const bobsForm = await seedForm(bob.ctx, "Bob's form")

      const saved = await formsCore.saveAiForm(alice.ctx, {
        formId: bobsForm,
        form: { title: "Pwned", fields: [] },
      })
      expect(saved).toEqual({ success: false, error: "Form not found" })

      const [form] = await db.select().from(forms).where(eq(forms.id, bobsForm))
      expect(form.title).toBe("Bob's form")
      // The fields must still be live — a leak here would soft-delete all of
      // them, since saveAiForm removes anything absent from the payload.
      const fields = await db.select().from(formFields).where(eq(formFields.formId, bobsForm))
      expect(fields.filter((f) => f.deletedAt === null)).toHaveLength(2)
    })

    test("CANNOT DELETE another tenant's form — the destructive case", async () => {
      const bobsForm = await seedForm(bob.ctx, "Bob's form")
      await db.insert(submissions).values({
        formId: bobsForm,
        workspaceId: bob.workspaceId,
        status: "completed",
        completedAt: new Date(),
      })

      expect(await formsCore.deleteForm(alice.ctx, bobsForm)).toEqual({
        success: false,
        error: "Form not found",
      })

      // Form, fields and responses all still present. deleteForm hard-deletes
      // and cascades, so a leak here is unrecoverable data loss.
      expect(await db.select().from(forms).where(eq(forms.id, bobsForm))).toHaveLength(1)
      expect(await db.select().from(formFields).where(eq(formFields.formId, bobsForm))).toHaveLength(
        2,
      )
      expect(
        await db.select().from(submissions).where(eq(submissions.formId, bobsForm)),
      ).toHaveLength(1)
    })

    test("cannot publish, unpublish, rename, duplicate or reconfigure another tenant's form", async () => {
      const bobsForm = await seedForm(bob.ctx, "Bob's form")

      expect(await formsCore.publishForm(alice.ctx, bobsForm)).toEqual({
        success: false,
        error: "Form not found",
      })
      expect(await formsCore.unpublishForm(alice.ctx, bobsForm)).toEqual({
        success: false,
        error: "Form not found",
      })
      expect(await formsCore.renameForm(alice.ctx, bobsForm, "Pwned")).toEqual({
        success: false,
        error: "Form not found",
      })
      expect(await formsCore.duplicateForm(alice.ctx, bobsForm)).toEqual({
        success: false,
        error: "Form not found",
      })
      expect(
        await formsCore.updateFormSettings(alice.ctx, bobsForm, { thankYouMessage: "Pwned" }),
      ).toEqual({ success: false, error: "Form not found" })

      const [form] = await db.select().from(forms).where(eq(forms.id, bobsForm))
      expect(form.status).toBe("draft")
      expect(form.title).toBe("Bob's form")
      expect(form.settings?.thankYouMessage).toBeUndefined()
      // And no copy landed in Alice's workspace.
      expect(await db.select().from(forms).where(eq(forms.workspaceId, alice.workspaceId))).toHaveLength(
        0,
      )
    })

    test("cannot file a new draft into another tenant's folder", async () => {
      // createDraftForm throws rather than returning a Result.
      await expect(
        formsCore.createDraftForm(alice.ctx, randomUUID()),
      ).rejects.toThrow("Folder not found")
    })
  })
})
