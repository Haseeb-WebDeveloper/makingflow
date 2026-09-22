/**
 * The access button and its dialog.
 *
 * This is a control that hands real people access to somebody's Drive, so what it
 * says has to be exactly true: whether a form decided for itself or is following
 * the workspace, and that applying a workspace-wide choice will overwrite the
 * forms that decided. A button that reads "All members" when one of them is
 * blocked is the failure this file exists to prevent.
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { AccessButton } from "@/components/integrations/sheet-access"
import type { FormAccess } from "@/lib/data/integrations"

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

const members = [
  { email: "a@acme.com", state: "shared" as const, reason: null },
  { email: "b@gmail.com", state: "pending" as const, reason: null },
]

const inherited: FormAccess = {
  source: "workspace",
  role: "reader",
  audience: "all",
  granted: 2,
  blocked: 0,
}

describe("AccessButton", () => {
  test("says who can open it, in as few words as possible", () => {
    render(
      <AccessButton scope={{ kind: "form", formId: "f1" }} access={inherited} members={members} />,
    )
    expect(screen.getByRole("button", { name: /all members/i })).toBeTruthy()
  })

  test("names the number when only some people have access", () => {
    render(
      <AccessButton
        scope={{ kind: "form", formId: "f1" }}
        access={{
          source: "form",
          role: "reader",
          audience: { emails: ["a@acme.com"] },
          granted: 1,
          blocked: 0,
        }}
        members={members}
      />,
    )
    expect(screen.getByRole("button", { name: /1 member/i })).toBeTruthy()
  })

  test("a blocked person wins the label over a reassuring count", () => {
    render(
      <AccessButton
        scope={{ kind: "form", formId: "f1" }}
        access={{ ...inherited, granted: 1, blocked: 1 }}
        members={[{ email: "b@gmail.com", state: "blocked", reason: "domain_policy" }]}
      />,
    )
    expect(screen.getByRole("button", { name: /1 blocked/i })).toBeTruthy()
  })

  test("reads as private when nobody has access", () => {
    render(
      <AccessButton
        scope={{ kind: "form", formId: "f1" }}
        access={{ source: "form", role: null, audience: null, granted: 0, blocked: 0 }}
        members={members}
      />,
    )
    expect(screen.getByRole("button", { name: /private/i })).toBeTruthy()
  })

  test("a form following the workspace says so in the dialog, not on the button", () => {
    render(
      <AccessButton scope={{ kind: "form", formId: "f1" }} access={inherited} members={members} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /all members/i }))
    expect(screen.getByText(/following the workspace/i)).toBeTruthy()
  })

  test("choosing a role for one form calls the per-form action", () => {
    render(
      <AccessButton scope={{ kind: "form", formId: "f1" }} access={inherited} members={members} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /all members/i }))
    fireEvent.click(screen.getByRole("button", { name: /^editor$/i }))

    expect(setFormSheetSharing).toHaveBeenCalledWith("f1", {
      role: "writer",
      audience: "all",
    })
    expect(setSheetSharing).not.toHaveBeenCalled()
  })

  test("the workspace-wide button warns before overwriting customised forms", () => {
    render(
      <AccessButton
        scope={{ kind: "workspace", customisedForms: 2 }}
        access={inherited}
        members={members}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /all members/i }))

    expect(screen.getByText(/2 forms are customised/i)).toBeTruthy()
  })

  test("with nothing customised there is no warning to ignore", () => {
    render(
      <AccessButton
        scope={{ kind: "workspace", customisedForms: 0 }}
        access={inherited}
        members={members}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /all members/i }))

    expect(screen.queryByText(/forms are customised/i)).toBeNull()
  })

  test("a workspace-wide choice calls the workspace action", () => {
    render(
      <AccessButton
        scope={{ kind: "workspace", customisedForms: 0 }}
        access={inherited}
        members={members}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /all members/i }))
    fireEvent.click(screen.getByRole("button", { name: /^off$/i }))

    expect(setSheetSharing).toHaveBeenCalledWith(null)
    expect(setFormSheetSharing).not.toHaveBeenCalled()
  })

  test("read-only for someone who cannot change it", () => {
    render(
      <AccessButton
        scope={{ kind: "form", formId: "f1" }}
        access={inherited}
        members={members}
        canManage={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /all members/i }))
    expect(screen.queryByRole("button", { name: /^editor$/i })).toBeNull()
  })
})
