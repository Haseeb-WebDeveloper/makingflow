/**
 * Who should be able to open a form's spreadsheet, with what role, and what has
 * to change to make that true.
 *
 * Pure functions, deliberately: this is the code that decides whether somebody's
 * access is withdrawn, and that decision should be readable without a database in
 * the room.
 *
 * The model mirrors what the share dialog shows — a general access level for the
 * whole workspace, and named people whose own level beats it (including "none",
 * which is how one person is excluded from an otherwise open sheet).
 */

import { describe, expect, test } from "vitest"
import {
  desiredRoles,
  planShareChanges,
  resolveSharing,
} from "@/lib/integrations/sheets-sharing"
import type { SheetShare } from "@/lib/db/schema"

const MEMBERS = ["owner@acme.com", "a@acme.com", "b@gmail.com"]
const OWNER = "owner@acme.com"

/** desiredRoles returns a Map; compare as a plain object. */
const asObject = (m: Map<string, "reader" | "writer">) => Object.fromEntries(m)

describe("desiredRoles", () => {
  test("nobody when nothing is set", () => {
    expect(asObject(desiredRoles(undefined, MEMBERS, OWNER))).toEqual({})
  })

  test("general access gives every member that role", () => {
    expect(asObject(desiredRoles({ general: "reader" }, MEMBERS, OWNER))).toEqual({
      "a@acme.com": "reader",
      "b@gmail.com": "reader",
    })
  })

  test("the account that owns the files is never included", () => {
    // Drive refuses to share a file with its owner, and recording that refusal
    // would park a permanent failure on the one person who already has access.
    const roles = desiredRoles({ general: "writer" }, MEMBERS, OWNER)
    expect(roles.has(OWNER)).toBe(false)
  })

  test("restricted general access means only the named people", () => {
    expect(
      asObject(
        desiredRoles(
          { general: null, people: [{ email: "b@gmail.com", role: "writer" }] },
          MEMBERS,
          OWNER,
        ),
      ),
    ).toEqual({ "b@gmail.com": "writer" })
  })

  test("a person's own role beats general access", () => {
    expect(
      asObject(
        desiredRoles(
          { general: "reader", people: [{ email: "a@acme.com", role: "writer" }] },
          MEMBERS,
          OWNER,
        ),
      ),
    ).toEqual({ "a@acme.com": "writer", "b@gmail.com": "reader" })
  })

  test("one person can be excluded from an otherwise open sheet", () => {
    expect(
      asObject(
        desiredRoles(
          { general: "reader", people: [{ email: "b@gmail.com", role: "none" }] },
          MEMBERS,
          OWNER,
        ),
      ),
    ).toEqual({ "a@acme.com": "reader" })
  })

  test("someone named who is no longer a member is dropped", () => {
    expect(
      asObject(
        desiredRoles(
          { general: null, people: [{ email: "gone@acme.com", role: "reader" }] },
          MEMBERS,
          OWNER,
        ),
      ),
    ).toEqual({})
  })

  test("addresses are compared case-insensitively", () => {
    expect(
      asObject(
        desiredRoles(
          { general: "reader", people: [{ email: "A@ACME.COM", role: "none" }] },
          ["a@acme.com"],
          OWNER,
        ),
      ),
    ).toEqual({})
  })
})

describe("resolveSharing", () => {
  const workspace = { general: "reader" as const }

  test("a form with no setting of its own follows the workspace", () => {
    expect(resolveSharing(workspace, undefined)).toEqual(workspace)
  })

  test("a form's own setting wins", () => {
    const own = { general: null, people: [{ email: "a@acme.com", role: "writer" as const }] }
    expect(resolveSharing(workspace, own)).toEqual(own)
  })

  test("a form can be private while the workspace shares", () => {
    // Private is a setting, not the absence of one: "nobody may open this" and
    // "nobody has chosen for this form" must stay distinguishable, or a private
    // form re-opens itself the next time the workspace setting changes.
    expect(resolveSharing(workspace, { general: null })).toEqual({ general: null })
  })

  test("a form can share when the workspace does not", () => {
    const own = { general: "reader" as const }
    expect(resolveSharing(undefined, own)).toEqual(own)
  })
})

describe("planShareChanges", () => {
  const granted = (email: string, role: "reader" | "writer" = "reader"): SheetShare => ({
    email,
    role,
    permissionId: `perm-${email}`,
  })
  const want = (entries: [string, "reader" | "writer"][]) => new Map(entries)

  test("grants access nobody has yet", () => {
    const plan = planShareChanges(want([["a@acme.com", "reader"]]), [])
    expect(plan.grant).toEqual([{ email: "a@acme.com", role: "reader" }])
    expect(plan.revoke).toEqual([])
  })

  test("leaves an existing grant alone", () => {
    const plan = planShareChanges(want([["a@acme.com", "reader"]]), [granted("a@acme.com")])
    expect(plan.grant).toEqual([])
    expect(plan.revoke).toEqual([])
    expect(plan.keep.map((s) => s.email)).toEqual(["a@acme.com"])
  })

  test("revokes a grant for someone no longer entitled to it", () => {
    const plan = planShareChanges(want([]), [granted("a@acme.com")])
    expect(plan.revoke.map((s) => s.permissionId)).toEqual(["perm-a@acme.com"])
    expect(plan.keep).toEqual([])
  })

  test("a role change is a revoke plus a grant", () => {
    const plan = planShareChanges(want([["a@acme.com", "writer"]]), [
      granted("a@acme.com", "reader"),
    ])
    expect(plan.revoke.map((s) => s.email)).toEqual(["a@acme.com"])
    expect(plan.grant).toEqual([{ email: "a@acme.com", role: "writer" }])
  })

  test("never revokes an entry with no permission id", () => {
    // Someone shared this by hand in Drive, or an attempt of ours failed. Either
    // way it is not ours to remove.
    const plan = planShareChanges(want([]), [{ email: "a@acme.com", role: "reader" }])
    expect(plan.revoke).toEqual([])
  })

  test("retries an address whose last attempt failed", () => {
    const plan = planShareChanges(want([["a@acme.com", "reader"]]), [
      { email: "a@acme.com", role: "reader", error: "failed" },
    ])
    expect(plan.grant).toEqual([{ email: "a@acme.com", role: "reader" }])
    expect(plan.revoke).toEqual([])
  })

  test("matches a stored grant to a desired address case-insensitively", () => {
    const plan = planShareChanges(want([["A@Acme.com", "reader"]]), [granted("a@acme.com")])
    expect(plan.grant).toEqual([])
    expect(plan.revoke).toEqual([])
  })
})
