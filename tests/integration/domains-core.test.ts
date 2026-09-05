/**
 * Custom domains — the one place where a tenancy slip is visible to the public.
 *
 * A custom domain is a workspace's brand: forms.acme.com is Acme telling their
 * customers "this page is us". Attaching a form to a domain is therefore two
 * separate ownership questions, and BOTH have to be answered against the
 * caller's workspace:
 *
 *   - is this form mine?    (else I edit someone else's form)
 *   - is this domain mine?  (else I publish MY content on THEIR brand)
 *
 * The second is the interesting one. It is easy to write, and wrong, to check
 * only the form — the domain id then travels straight from the request into the
 * update. These tests pin both halves.
 *
 * Vercel is not configured in tests, so `addCustomDomain` is asserted only on
 * its refusal. The rows the other tests need are inserted directly, which is
 * what the verification callback does in production anyway.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { customDomains, forms, users, workspaceMembers, workspaces } from "@/lib/db/schema"
import * as domainsCore from "@/lib/core/domains"
import { testContext } from "../helpers/context"

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
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
  const [form] = await db
    .insert(forms)
    .values({
      workspaceId: workspace.id,
      title: `${label}'s form`,
      publicId: `dom${seq}${Math.floor(Date.now() % 1e6)}`,
    })
    .returning({ id: forms.id })

  /** An already-verified domain, as the Vercel check would have left it. */
  async function activeDomain(host: string) {
    const [row] = await db
      .insert(customDomains)
      .values({ workspaceId: workspace.id, domain: host, status: "active" })
      .returning({ id: customDomains.id, domain: customDomains.domain })
    return row
  }

  return {
    ctx: testContext({ userId: user.id, workspaceId: workspace.id }),
    workspaceId: workspace.id,
    formId: form.id,
    activeDomain,
  }
}

describe("core/domains", () => {
  let alice: Awaited<ReturnType<typeof seedTenant>>
  let bob: Awaited<ReturnType<typeof seedTenant>>

  beforeEach(async () => {
    alice = await seedTenant("alice")
    bob = await seedTenant("bob")
  })

  describe("setFormDomain", () => {
    test("attaches a form to a domain the workspace owns", async () => {
      seq += 1
      const dom = await alice.activeDomain(`forms.alice-${seq}-${Date.now()}.test`)

      expect(
        await domainsCore.setFormDomain(alice.ctx, alice.formId, {
          customDomainId: dom.id,
          slug: "Feedback Form",
        }),
      ).toEqual({ success: true, domain: dom.domain, slug: "feedback-form" })

      const [row] = await db
        .select({ customDomainId: forms.customDomainId, slug: forms.slug })
        .from(forms)
        .where(eq(forms.id, alice.formId))
      expect(row).toEqual({ customDomainId: dom.id, slug: "feedback-form" })
    })

    test("cannot publish my form on another tenant's domain", async () => {
      // The whole point of the ownership check on the domain: without it, Alice
      // serves her content from Bob's brand.
      seq += 1
      const bobsDomain = await bob.activeDomain(`forms.bob-${seq}-${Date.now()}.test`)

      expect(
        await domainsCore.setFormDomain(alice.ctx, alice.formId, {
          customDomainId: bobsDomain.id,
          slug: "hijack",
        }),
      ).toEqual({ success: false, error: "That domain isn't available." })

      const [row] = await db
        .select({ customDomainId: forms.customDomainId })
        .from(forms)
        .where(eq(forms.id, alice.formId))
      expect(row.customDomainId).toBeNull()
    })

    test("cannot move another tenant's form onto my domain", async () => {
      seq += 1
      const mine = await alice.activeDomain(`forms.alice-${seq}-${Date.now()}.test`)

      expect(
        await domainsCore.setFormDomain(alice.ctx, bob.formId, {
          customDomainId: mine.id,
          slug: "steal",
        }),
      ).toEqual({ success: false, error: "Form not found" })

      const [row] = await db
        .select({ customDomainId: forms.customDomainId })
        .from(forms)
        .where(eq(forms.id, bob.formId))
      expect(row.customDomainId).toBeNull()
    })

    test("a pending domain is not usable yet", async () => {
      seq += 1
      const [pending] = await db
        .insert(customDomains)
        .values({
          workspaceId: alice.workspaceId,
          domain: `pending-${seq}-${Date.now()}.example.test`,
          status: "pending",
        })
        .returning({ id: customDomains.id })

      expect(
        await domainsCore.setFormDomain(alice.ctx, alice.formId, {
          customDomainId: pending.id,
          slug: "early",
        }),
      ).toEqual({ success: false, error: "That domain isn't available." })
    })

    test("two forms cannot share a slug on the same domain", async () => {
      seq += 1
      const dom = await alice.activeDomain(`forms.alice-${seq}-${Date.now()}.test`)
      const [second] = await db
        .insert(forms)
        .values({
          workspaceId: alice.workspaceId,
          title: "Second",
          publicId: `dom2${seq}${Math.floor(Date.now() % 1e6)}`,
        })
        .returning({ id: forms.id })

      expect(
        await domainsCore.setFormDomain(alice.ctx, alice.formId, {
          customDomainId: dom.id,
          slug: "contact",
        }),
      ).toMatchObject({ success: true })

      expect(
        await domainsCore.setFormDomain(alice.ctx, second.id, {
          customDomainId: dom.id,
          slug: "contact",
        }),
      ).toEqual({ success: false, error: `"contact" is already used on ${dom.domain}.` })
    })

    test("re-saving a form's own slug is not a clash with itself", async () => {
      seq += 1
      const dom = await alice.activeDomain(`forms.alice-${seq}-${Date.now()}.test`)
      const input = { customDomainId: dom.id, slug: "contact" }
      expect(await domainsCore.setFormDomain(alice.ctx, alice.formId, input)).toMatchObject({
        success: true,
      })
      expect(await domainsCore.setFormDomain(alice.ctx, alice.formId, input)).toMatchObject({
        success: true,
      })
    })

    test("clearing the domain reverts the form to its default link", async () => {
      seq += 1
      const dom = await alice.activeDomain(`forms.alice-${seq}-${Date.now()}.test`)
      await domainsCore.setFormDomain(alice.ctx, alice.formId, {
        customDomainId: dom.id,
        slug: "feedback",
      })

      expect(
        await domainsCore.setFormDomain(alice.ctx, alice.formId, {
          customDomainId: null,
          slug: null,
        }),
      ).toEqual({ success: true, domain: null, slug: null })

      const [row] = await db
        .select({ customDomainId: forms.customDomainId, slug: forms.slug })
        .from(forms)
        .where(eq(forms.id, alice.formId))
      expect(row).toEqual({ customDomainId: null, slug: null })
    })

    test("a slug that survives slugification as empty is rejected", async () => {
      seq += 1
      const dom = await alice.activeDomain(`forms.alice-${seq}-${Date.now()}.test`)
      expect(
        await domainsCore.setFormDomain(alice.ctx, alice.formId, {
          customDomainId: dom.id,
          slug: "!!!",
        }),
      ).toEqual({ success: false, error: "Enter a path for the form (e.g. feedback)." })
    })
  })

  describe("check and remove", () => {
    test("cannot check or remove another tenant's domain", async () => {
      seq += 1
      const bobsDomain = await bob.activeDomain(`forms.bob-${seq}-${Date.now()}.test`)

      expect(await domainsCore.checkCustomDomain(alice.ctx, bobsDomain.id)).toEqual({
        success: false,
        error: "Domain not found",
      })
      expect(await domainsCore.removeCustomDomain(alice.ctx, bobsDomain.id)).toEqual({
        success: false,
        error: "Domain not found",
      })

      // Bob's domain is still there and still active — the refusal happened
      // before anything reached Vercel.
      const [row] = await db
        .select({ status: customDomains.status })
        .from(customDomains)
        .where(eq(customDomains.id, bobsDomain.id))
      expect(row.status).toBe("active")
    })
  })

  describe("addCustomDomain", () => {
    test("refuses cleanly when the deployment has no domain host configured", async () => {
      // Tests run without Vercel credentials, which is also how a self-hosted
      // deployment looks. The refusal must be a message, not a crash — and no
      // half-registered row may be left behind.
      const result = await domainsCore.addCustomDomain(alice.ctx, "forms.example.test")
      expect(result).toEqual({
        success: false,
        error: "Custom domains aren't configured on this deployment yet.",
      })
      expect(
        await db
          .select()
          .from(customDomains)
          .where(eq(customDomains.workspaceId, alice.workspaceId)),
      ).toHaveLength(0)
    })
  })
})
