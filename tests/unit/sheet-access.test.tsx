/**
 * The Share button, its dialog, and the rule that decides what gets stored.
 *
 * This control hands real people access to somebody's Drive, so the parts that
 * matter are: what it says about where things stand, and exactly what a save
 * writes. The first is asserted against the rendered dialog; the second against
 * `buildSharingSetting`, which is where that rule lives — a Radix select trigger
 * is a button, not something a test can meaningfully "change".
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  ShareButton,
  accessSummary,
  buildSharingSetting,
} from "@/components/integrations/sheet-access"
import type { AccessMemberState, FormAccess } from "@/lib/data/integrations"

const setSheetSharing = vi.fn(async () => ({ success: true }))
const setFormSheetSharing = vi.fn(async () => ({ success: true }))

vi.mock("@/lib/actions/integrations", () => ({
  setSheetSharing: (...args: unknown[]) => setSheetSharing(...(args as [])),
  setFormSheetSharing: (...args: unknown[]) => setFormSheetSharing(...(args as [])),
  reconcileSheetSharing: vi.fn(async () => ({ success: true })),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// globals: false means RTL registers no auto-cleanup of its own.
afterEach(() => {
  cleanup()
  setSheetSharing.mockClear()
  setFormSheetSharing.mockClear()
})

const OWNER = "owner@acme.com"

const members: AccessMemberState[] = [
  { email: "a@acme.com", role: "reader", state: "shared", reason: null },
  { email: "b@gmail.com", role: "reader", state: "blocked", reason: "domain_policy" },
]

const inherited: FormAccess = {
  source: "workspace",
  general: "reader",
  people: [],
  granted: 1,
  blocked: 1,
}

function openForm(access: Partial<FormAccess> = {}, canManage = true) {
  render(
    <ShareButton
      scope={{ kind: "form", formId: "f1" }}
      access={{ ...inherited, ...access }}
      members={members}
      accountEmail={OWNER}
      canManage={canManage}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: /share/i }))
}

// ── What a save writes ──────────────────────────────────────────────────────

describe("buildSharingSetting", () => {
  const people = [{ email: "a@acme.com" }, { email: "b@gmail.com" }]

  test("everyone on the same footing stores no exceptions at all", () => {
    expect(
      buildSharingSetting({
        audience: "everyone",
        everyoneRole: "reader",
        choices: { "a@acme.com": "inherit", "b@gmail.com": "inherit" },
        members: people,
      }),
    ).toEqual({ general: "reader" })
  })

  test("a role that matches the general line is not stored as an exception", () => {
    // Otherwise every member becomes a frozen entry, and the next person to join
    // the workspace quietly gets nothing.
    expect(
      buildSharingSetting({
        audience: "everyone",
        everyoneRole: "reader",
        choices: { "a@acme.com": "reader", "b@gmail.com": "inherit" },
        members: people,
      }),
    ).toEqual({ general: "reader" })
  })

  test("one person promoted to editor is stored as an exception", () => {
    expect(
      buildSharingSetting({
        audience: "everyone",
        everyoneRole: "reader",
        choices: { "a@acme.com": "writer", "b@gmail.com": "inherit" },
        members: people,
      }),
    ).toEqual({ general: "reader", people: [{ email: "a@acme.com", role: "writer" }] })
  })

  test("one person shut out of an open sheet is stored, not dropped", () => {
    expect(
      buildSharingSetting({
        audience: "everyone",
        everyoneRole: "reader",
        choices: { "a@acme.com": "inherit", "b@gmail.com": "none" },
        members: people,
      }),
    ).toEqual({ general: "reader", people: [{ email: "b@gmail.com", role: "none" }] })
  })

  test("choosing individuals stores them and nobody else", () => {
    expect(
      buildSharingSetting({
        audience: "chosen",
        everyoneRole: "reader",
        choices: { "a@acme.com": "reader", "b@gmail.com": "none" },
        members: people,
      }),
    ).toEqual({ general: null, people: [{ email: "a@acme.com", role: "reader" }] })
  })

  test("choosing nobody is a private sheet", () => {
    expect(
      buildSharingSetting({
        audience: "chosen",
        everyoneRole: "reader",
        choices: { "a@acme.com": "none", "b@gmail.com": "none" },
        members: people,
      }),
    ).toEqual({ general: null })
  })
})

// ── What the row says ───────────────────────────────────────────────────────

describe("accessSummary", () => {
  const base: FormAccess = { source: "workspace", general: null, people: [], granted: 0, blocked: 0 }

  test("a blocked person beats a reassuring count", () => {
    // The one state somebody has to act on, so it wins the label.
    expect(accessSummary({ ...base, general: "reader", granted: 3, blocked: 1 })).toBe("1 blocked")
  })

  test("everyone", () => {
    expect(accessSummary({ ...base, general: "reader" })).toBe("Everyone")
  })

  test("everyone, minus the people shut out", () => {
    expect(
      accessSummary({
        ...base,
        general: "reader",
        people: [{ email: "b@gmail.com", role: "none" }],
      }),
    ).toBe("Everyone except 1")
  })

  test("a named few", () => {
    expect(
      accessSummary({ ...base, people: [{ email: "a@acme.com", role: "reader" }] }),
    ).toBe("1 person")
  })

  test("nobody", () => {
    expect(accessSummary(base)).toBe("Private")
  })
})

// ── What the dialog shows ───────────────────────────────────────────────────

describe("the Share button", () => {
  test("carries a warning dot when somebody could not be given access", () => {
    // The one piece of state you cannot discover without opening the dialog.
    render(
      <ShareButton
        scope={{ kind: "form", formId: "f1" }}
        access={inherited}
        members={members}
        accountEmail={OWNER}
      />,
    )
    expect(screen.getByLabelText(/1 blocked/i)).toBeTruthy()
  })

  test("no dot when nobody is blocked", () => {
    render(
      <ShareButton
        scope={{ kind: "form", formId: "f1" }}
        access={{ ...inherited, blocked: 0 }}
        members={members}
        accountEmail={OWNER}
      />,
    )
    expect(screen.queryByLabelText(/blocked/i)).toBeNull()
  })
})

describe("the dialog", { timeout: 20_000 }, () => {
  test("opens on the button", () => {
    openForm()
    expect(screen.getByText(/share this spreadsheet/i)).toBeTruthy()
  })

  test("names the account whose Drive holds the files", () => {
    openForm({ source: "form" })
    expect(screen.getByText(/files live in owner@acme/i)).toBeTruthy()
  })

  test("a form following the workspace says so", () => {
    openForm()
    expect(screen.getByText(/following the workspace setting/i)).toBeTruthy()
  })

  test("asks who can open it before it talks about roles", () => {
    openForm()
    expect(screen.getByText(/everyone in the workspace/i)).toBeTruthy()
    expect(screen.getByText(/only the people i choose/i)).toBeTruthy()
  })

  test("lists every member, and the owner as the owner", () => {
    openForm()
    expect(screen.getByText("a@acme.com")).toBeTruthy()
    expect(screen.getByText("b@gmail.com")).toBeTruthy()
    expect(screen.getByText(/owns the files/i)).toBeTruthy()
  })

  test("explains a blocked person instead of implying they have access", () => {
    openForm()
    expect(screen.getByText(/blocks sharing outside the domain/i)).toBeTruthy()
  })

  test("says that responses are readable in the app regardless", () => {
    // Otherwise this reads as the only way colleagues see responses, and somebody
    // grants Drive access they never needed to grant.
    openForm()
    expect(screen.getByText(/always read responses inside MakingFlow/i)).toBeTruthy()
  })

  test("Save is inert until something changes", () => {
    openForm()
    const save = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  test("a customised form can be put back under the workspace", () => {
    openForm({ source: "form" })
    fireEvent.click(screen.getByRole("button", { name: /follow workspace/i }))
    expect(setFormSheetSharing).toHaveBeenCalledWith("f1", null)
  })

  test("a form following the workspace is not offered a way to follow it again", () => {
    openForm()
    expect(screen.queryByRole("button", { name: /follow workspace/i })).toBeNull()
  })

  test("the workspace-wide dialog warns before replacing per-form sharing", () => {
    render(
      <ShareButton
        scope={{ kind: "workspace", customisedForms: 2 }}
        access={inherited}
        members={members}
        accountEmail={OWNER}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    expect(screen.getByText(/2 forms have their own sharing/i)).toBeTruthy()
  })

  test("with nothing customised there is no warning to ignore", () => {
    render(
      <ShareButton
        scope={{ kind: "workspace", customisedForms: 0 }}
        access={inherited}
        members={members}
        accountEmail={OWNER}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    expect(screen.queryByText(/their own sharing/i)).toBeNull()
  })

  test("somebody who cannot manage it sees the state and no controls", () => {
    openForm({}, false)
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull()
    expect(screen.getByText("a@acme.com")).toBeTruthy()
    // Both members inherit Viewer, so both say so — as text, not as a control.
    expect(screen.getAllByText(/^can view$/i)).toHaveLength(2)
    // And the audience reads as a sentence rather than a radio they cannot use.
    expect(screen.getByText(/everyone in the workspace can view/i)).toBeTruthy()
  })
})
