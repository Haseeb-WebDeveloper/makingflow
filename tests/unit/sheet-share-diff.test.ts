/**
 * Who should be able to open a form's spreadsheet, and what has to change to
 * make that true.
 *
 * Pure functions, deliberately: this is the code that decides whether somebody's
 * access is withdrawn, and that decision should be readable without a database
 * in the room.
 */

import { describe, expect, test } from "vitest"
import {
  desiredShareEmails,
  planShareChanges,
  resolveSharing,
} from "@/lib/integrations/sheets-sharing"
import type { SheetShare } from "@/lib/db/schema"

describe("desiredShareEmails", () => {
  const members = ["owner@acme.com", "a@acme.com", "b@gmail.com"]

  test("nobody when sharing is off", () => {
    expect(desiredShareEmails(undefined, members, "owner@acme.com")).toEqual([])
  })

  test("every member except the account that owns the files", () => {
    // Drive refuses to share a file with its own owner, and recording that
    // refusal would park a permanent "blocked" row on the card for the one
    // person who already has access.
    expect(
      desiredShareEmails({ role: "reader", audience: "all" }, members, "owner@acme.com"),
    ).toEqual(["a@acme.com", "b@gmail.com"])
  })

  test("only the chosen members when the audience is a list", () => {
    expect(
      desiredShareEmails(
        { role: "reader", audience: { emails: ["b@gmail.com"] } },
        members,
        "owner@acme.com",
      ),
    ).toEqual(["b@gmail.com"])
  })

  test("a chosen email that is no longer a member is dropped", () => {
    expect(
      desiredShareEmails(
        { role: "reader", audience: { emails: ["gone@acme.com"] } },
        members,
        "owner@acme.com",
      ),
    ).toEqual([])
  })

  test("addresses are compared case-insensitively", () => {
    expect(
      desiredShareEmails({ role: "reader", audience: "all" }, ["A@Acme.com"], "a@acme.com"),
    ).toEqual([])
  })

  test("a member listed twice is asked for once", () => {
    expect(
      desiredShareEmails({ role: "reader", audience: "all" }, ["a@acme.com", "A@ACME.COM"], "o@x.com"),
    ).toEqual(["a@acme.com"])
  })
})

describe("planShareChanges", () => {
  const granted = (email: string, role: "reader" | "writer" = "reader"): SheetShare => ({
    email,
    role,
    permissionId: `perm-${email}`,
  })

  test("grants access nobody has yet", () => {
    const plan = planShareChanges(["a@acme.com"], "reader", [])
    expect(plan.grant).toEqual(["a@acme.com"])
    expect(plan.revoke).toEqual([])
  })

  test("leaves an existing grant alone", () => {
    const plan = planShareChanges(["a@acme.com"], "reader", [granted("a@acme.com")])
    expect(plan.grant).toEqual([])
    expect(plan.revoke).toEqual([])
    expect(plan.keep.map((s) => s.email)).toEqual(["a@acme.com"])
  })

  test("revokes a grant for someone no longer entitled to it", () => {
    const plan = planShareChanges([], "reader", [granted("a@acme.com")])
    expect(plan.revoke.map((s) => s.permissionId)).toEqual(["perm-a@acme.com"])
    expect(plan.keep).toEqual([])
  })

  test("a role change is a revoke plus a grant", () => {
    const plan = planShareChanges(["a@acme.com"], "writer", [granted("a@acme.com", "reader")])
    expect(plan.revoke.map((s) => s.email)).toEqual(["a@acme.com"])
    expect(plan.grant).toEqual(["a@acme.com"])
  })

  test("never revokes an entry with no permission id", () => {
    // Someone shared this by hand in Drive, or one of our attempts failed.
    // Either way it is not ours to remove.
    const plan = planShareChanges([], "reader", [{ email: "a@acme.com", role: "reader" }])
    expect(plan.revoke).toEqual([])
  })

  test("retries an address whose last attempt failed", () => {
    const plan = planShareChanges(["a@acme.com"], "reader", [
      { email: "a@acme.com", role: "reader", error: "failed" },
    ])
    expect(plan.grant).toEqual(["a@acme.com"])
    expect(plan.revoke).toEqual([])
  })

  test("matches a stored grant to a desired address case-insensitively", () => {
    const plan = planShareChanges(["A@Acme.com"], "reader", [granted("a@acme.com")])
    expect(plan.grant).toEqual([])
    expect(plan.revoke).toEqual([])
  })
})

describe("resolveSharing", () => {
  const workspace = { role: "reader" as const, audience: "all" as const }

  test("a form with no override follows the workspace", () => {
    expect(resolveSharing(workspace, undefined)).toEqual(workspace)
  })

  test("an override wins", () => {
    const own = { role: "writer" as const, audience: { emails: ["a@acme.com"] } }
    expect(resolveSharing(workspace, own)).toEqual(own)
  })

  test("a form can opt out while the workspace shares", () => {
    // "none" has to be distinguishable from "no override", or opting one form out
    // would be indistinguishable from never having chosen.
    expect(resolveSharing(workspace, "none")).toBeUndefined()
  })

  test("an override still applies when the workspace shares nothing", () => {
    const own = { role: "reader" as const, audience: "all" as const }
    expect(resolveSharing(undefined, own)).toEqual(own)
  })

  test("nothing set anywhere means nobody", () => {
    expect(resolveSharing(undefined, undefined)).toBeUndefined()
  })
})
