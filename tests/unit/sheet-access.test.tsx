/**
 * The Share button and its dialog.
 *
 * This control hands real people access to somebody's Drive, so what it shows has
 * to be exactly true: each person's own role, whether a form decided for itself or
 * is following the workspace, and that saving a workspace-wide choice replaces the
 * forms that decided. Nothing is written until Save, so a half-made change cannot
 * share a file by accident.
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ShareButton } from "@/components/integrations/sheet-access"
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

function renderForm(access: Partial<FormAccess> = {}, canManage = true) {
  return render(
    <ShareButton
      scope={{ kind: "form", formId: "f1" }}
      access={{ ...inherited, ...access }}
      members={members}
      accountEmail={OWNER}
      canManage={canManage}
    />,
  )
}

describe("the Share button", () => {
  test("opens the dialog", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    expect(screen.getByText(/share this sheet/i)).toBeTruthy()
  })

  test("carries a warning dot when somebody could not be given access", () => {
    // The one piece of state you cannot discover by opening the dialog yourself.
    renderForm()
    expect(screen.getByLabelText(/1 blocked/i)).toBeTruthy()
  })

  test("no dot when nobody is blocked", () => {
    renderForm({ blocked: 0 })
    expect(screen.queryByLabelText(/blocked/i)).toBeNull()
  })
})

describe("the dialog", () => {
  test("names the account that owns the files", () => {
    renderForm({ source: "form" })
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    // It appears twice on purpose — the subtitle says whose Drive, and the list
    // shows the owner's own row. The subtitle is the one that has to be there.
    expect(screen.getByText(/files live in owner@acme/i)).toBeTruthy()
  })

  test("a form following the workspace says so", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    expect(screen.getByText(/following the workspace setting/i)).toBeTruthy()
  })

  test("each person gets their own role, set to what the setting gives them", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    const select = screen.getByLabelText("Access for a@acme.com") as HTMLSelectElement
    expect(select.value).toBe("reader")
  })

  test("explains a blocked person instead of implying they have access", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    expect(screen.getByText(/blocks sharing outside the domain/i)).toBeTruthy()
  })

  test("saves one person's role change as a named exception to general access", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    fireEvent.change(screen.getByLabelText("Access for a@acme.com"), {
      target: { value: "writer" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    expect(setFormSheetSharing).toHaveBeenCalledWith("f1", {
      general: "reader",
      people: [{ email: "a@acme.com", role: "writer" }],
    })
  })

  test("a person set to No access is stored as an exception, not dropped", () => {
    // Otherwise they would inherit general access again on the next save.
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    fireEvent.change(screen.getByLabelText("Access for a@acme.com"), {
      target: { value: "none" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    expect(setFormSheetSharing).toHaveBeenCalledWith("f1", {
      general: "reader",
      people: [{ email: "a@acme.com", role: "none" }],
    })
  })

  test("restricting general access stores no redundant exceptions", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    fireEvent.change(screen.getByLabelText("General access"), {
      target: { value: "restricted" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    // Everyone was on "reader" from general access; with general restricted they
    // all become exceptions — which is the truthful record of what was on screen.
    expect(setFormSheetSharing).toHaveBeenCalledWith("f1", {
      general: null,
      people: [
        { email: "a@acme.com", role: "reader" },
        { email: "b@gmail.com", role: "reader" },
      ],
    })
  })

  test("Save is inert until something actually changes", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    const save = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  test("a customised form can be put back under the workspace", () => {
    renderForm({ source: "form" })
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    fireEvent.click(screen.getByRole("button", { name: /follow workspace/i }))

    expect(setFormSheetSharing).toHaveBeenCalledWith("f1", null)
  })

  test("the workspace-wide dialog warns before replacing per-form choices", () => {
    render(
      <ShareButton
        scope={{ kind: "workspace", customisedForms: 2 }}
        access={inherited}
        members={members}
        accountEmail={OWNER}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share/i }))

    expect(screen.getByText(/2 forms have its own access|2 forms have/i)).toBeTruthy()
  })

  test("a workspace-wide save goes through the workspace action", () => {
    render(
      <ShareButton
        scope={{ kind: "workspace", customisedForms: 0 }}
        access={inherited}
        members={members}
        accountEmail={OWNER}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share/i }))
    fireEvent.change(screen.getByLabelText("General access"), { target: { value: "writer" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    expect(setSheetSharing).toHaveBeenCalled()
    expect(setFormSheetSharing).not.toHaveBeenCalled()
  })

  test("somebody who cannot manage it sees the state and no controls", () => {
    renderForm({}, false)
    fireEvent.click(screen.getByRole("button", { name: /share/i }))

    expect(screen.queryByLabelText("Access for a@acme.com")).toBeNull()
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull()
    expect(screen.getByText("a@acme.com")).toBeTruthy()
  })
})
