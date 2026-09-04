/**
 * The folder core, and the tenancy guarantee it has to hold.
 *
 * folders.ts is the pattern-setter for the whole core-layer migration, so this
 * file is the pattern-setter for how core modules get tested: seed two real
 * tenants, construct each caller's context literally, and prove that one
 * tenant's context cannot touch the other's rows.
 *
 * The cross-tenant assertions check two things, not one. "Returns not found" is
 * necessary but not sufficient — a function could report failure while still
 * having written something on the way. So every one of them also re-reads the
 * victim row and asserts it is unchanged.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { folders, forms, users, workspaces } from "@/lib/db/schema"
import * as foldersCore from "@/lib/core/folders"
import { testContext } from "../helpers/context"
import { cacheSpy, resetCacheSpy } from "../helpers/cache-spy"

let seq = 0

async function seedTenant(label: string) {
  seq += 1
  const unique = `${label}-${seq}-${Date.now()}`
  // users.id is the Supabase auth uid — supplied by the app, not defaulted.
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
  }
}

async function seedForm(workspaceId: string, folderId: string | null = null) {
  seq += 1
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId,
      folderId,
      title: "Job Application",
      publicId: `fld${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })
  return form.id
}

describe("core/folders", () => {
  let alice: Awaited<ReturnType<typeof seedTenant>>
  let bob: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    alice = await seedTenant("alice")
    bob = await seedTenant("bob")
    resetCacheSpy()
  })

  test("a successful move invalidates both the form and the workspace list", async () => {
    const created = await foldersCore.createFolder(alice.ctx, "Shortlist")
    if (!created.success) throw new Error("setup failed")
    const formId = await seedForm(alice.workspaceId)
    resetCacheSpy()

    await foldersCore.moveFormToFolder(alice.ctx, formId, created.id)

    // Skipping either of these leaves a stale read somewhere: the dashboard
    // list, or the form's own cached shell/settings.
    expect(cacheSpy().tags).toContain(`workspace-forms-${alice.workspaceId}`)
    expect(cacheSpy().tags).toContain(`form-${formId}`)
  })

  test("a rejected move invalidates nothing", async () => {
    const bobsForm = await seedForm(bob.workspaceId)
    resetCacheSpy()

    await foldersCore.moveFormToFolder(alice.ctx, bobsForm, null)

    expect(cacheSpy().tags).toEqual([])
    expect(cacheSpy().paths).toEqual([])
  })

  describe("within a tenant", () => {
    test("creates a folder in the caller's workspace", async () => {
      const result = await foldersCore.createFolder(alice.ctx, "  Candidates  ")
      expect(result.success).toBe(true)

      const [row] = await db.select().from(folders).where(eq(folders.workspaceId, alice.workspaceId))
      // The name is trimmed on the way in.
      expect(row.name).toBe("Candidates")
    })

    test("rejects a blank name rather than creating an untitled folder", async () => {
      const result = await foldersCore.createFolder(alice.ctx, "   ")
      expect(result).toEqual({ success: false, error: "Enter a folder name." })

      const rows = await db.select().from(folders).where(eq(folders.workspaceId, alice.workspaceId))
      expect(rows).toHaveLength(0)
    })

    test("renames a folder", async () => {
      const created = await foldersCore.createFolder(alice.ctx, "Old")
      if (!created.success) throw new Error("setup failed")

      expect(await foldersCore.renameFolder(alice.ctx, created.id, "New")).toEqual({
        success: true,
      })

      const [row] = await db.select().from(folders).where(eq(folders.id, created.id))
      expect(row.name).toBe("New")
    })

    test("deleting a folder un-files its forms instead of deleting them", async () => {
      const created = await foldersCore.createFolder(alice.ctx, "Archive")
      if (!created.success) throw new Error("setup failed")
      const formId = await seedForm(alice.workspaceId, created.id)

      expect(await foldersCore.deleteFolder(alice.ctx, created.id)).toEqual({ success: true })

      // The form survives, merely un-filed — losing responses to a folder
      // delete would be a catastrophe, so this is the assertion that matters.
      const [form] = await db.select().from(forms).where(eq(forms.id, formId))
      expect(form).toBeDefined()
      expect(form.folderId).toBeNull()
      expect(await db.select().from(folders).where(eq(folders.id, created.id))).toHaveLength(0)
    })

    test("moves a form into and back out of a folder", async () => {
      const created = await foldersCore.createFolder(alice.ctx, "Shortlist")
      if (!created.success) throw new Error("setup failed")
      const formId = await seedForm(alice.workspaceId)

      expect(await foldersCore.moveFormToFolder(alice.ctx, formId, created.id)).toEqual({
        success: true,
      })
      expect((await db.select().from(forms).where(eq(forms.id, formId)))[0].folderId).toBe(
        created.id,
      )

      expect(await foldersCore.moveFormToFolder(alice.ctx, formId, null)).toEqual({ success: true })
      expect((await db.select().from(forms).where(eq(forms.id, formId)))[0].folderId).toBeNull()
    })
  })

  describe("across tenants", () => {
    test("cannot rename another tenant's folder", async () => {
      const bobs = await foldersCore.createFolder(bob.ctx, "Bob private")
      if (!bobs.success) throw new Error("setup failed")

      expect(await foldersCore.renameFolder(alice.ctx, bobs.id, "Pwned")).toEqual({
        success: false,
        error: "Folder not found",
      })
      expect((await db.select().from(folders).where(eq(folders.id, bobs.id)))[0].name).toBe(
        "Bob private",
      )
    })

    test("cannot delete another tenant's folder", async () => {
      const bobs = await foldersCore.createFolder(bob.ctx, "Bob private")
      if (!bobs.success) throw new Error("setup failed")
      const bobsForm = await seedForm(bob.workspaceId, bobs.id)

      expect(await foldersCore.deleteFolder(alice.ctx, bobs.id)).toEqual({
        success: false,
        error: "Folder not found",
      })

      // The folder survives AND its form is still filed under it — deleteFolder
      // un-files before it deletes, so a leak here would strip Bob's form of its
      // folder even though the delete "failed".
      expect(await db.select().from(folders).where(eq(folders.id, bobs.id))).toHaveLength(1)
      expect((await db.select().from(forms).where(eq(forms.id, bobsForm)))[0].folderId).toBe(bobs.id)
    })

    test("cannot move another tenant's form", async () => {
      const alices = await foldersCore.createFolder(alice.ctx, "Alice folder")
      if (!alices.success) throw new Error("setup failed")
      const bobsForm = await seedForm(bob.workspaceId)

      expect(await foldersCore.moveFormToFolder(alice.ctx, bobsForm, alices.id)).toEqual({
        success: false,
        error: "Form not found",
      })
      expect((await db.select().from(forms).where(eq(forms.id, bobsForm)))[0].folderId).toBeNull()
    })

    test("cannot file its own form into another tenant's folder", async () => {
      const bobs = await foldersCore.createFolder(bob.ctx, "Bob folder")
      if (!bobs.success) throw new Error("setup failed")
      const alicesForm = await seedForm(alice.workspaceId)

      expect(await foldersCore.moveFormToFolder(alice.ctx, alicesForm, bobs.id)).toEqual({
        success: false,
        error: "Folder not found",
      })
      expect((await db.select().from(forms).where(eq(forms.id, alicesForm)))[0].folderId).toBeNull()
    })
  })
})
