/**
 * The sharing control.
 *
 * Two things must be true on screen, and both are things products get wrong when
 * they ship this feature: it has to say WHOSE Drive the files are in, and a member
 * who cannot be given access has to be told why rather than left looking granted.
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SheetSharingControl } from "@/components/integrations/sheet-sharing-control"

vi.mock("@/lib/actions/integrations", () => ({
  setSheetSharing: vi.fn(async () => ({ success: true })),
  reconcileSheetSharing: vi.fn(async () => ({ success: true })),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// globals: false means RTL never registers its own auto-cleanup, so without this
// every render stays in the document and the next query finds two of everything.
afterEach(cleanup)

const base = {
  customisedForms: 0,
  setting: { role: "reader" as const, audience: "all" as const },
  members: [
    { email: "a@acme.com", state: "shared" as const, reason: null, sheets: 3 },
    {
      email: "b@gmail.com",
      state: "blocked" as const,
      reason: "domain_policy" as const,
      sheets: 0,
    },
  ],
}

describe("SheetSharingControl", () => {
  test("names the account whose Drive holds the files", () => {
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage />)
    expect(screen.getByText(/owner@acme\.com/)).toBeTruthy()
  })

  test("explains a blocked member instead of implying they have access", () => {
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage />)
    expect(screen.getByText(/outside the domain/i)).toBeTruthy()
    expect(screen.getByText(/shared · 3 spreadsheets/i)).toBeTruthy()
  })

  test("offers a way to retry when someone is blocked", () => {
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage />)
    expect(screen.getByRole("button", { name: /re-check access/i })).toBeTruthy()
  })

  test("a member who cannot manage it sees no controls", () => {
    render(
      <SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage={false} />,
    )
    expect(screen.queryByRole("button", { name: /re-check access/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /^viewer$/i })).toBeNull()
    // The state is still visible — it just cannot be changed.
    expect(screen.getByText("b@gmail.com")).toBeTruthy()
  })

  test("off is a legible state, not an empty panel", () => {
    render(
      <SheetSharingControl
        sharing={{ setting: null, customisedForms: 0, members: [] }}
        accountEmail="owner@acme.com"
        canManage
      />,
    )
    expect(screen.getByText(/only owner@acme\.com can open/i)).toBeTruthy()
  })

  test("says that responses are readable in the app regardless", () => {
    // Otherwise this control reads as the only way colleagues can see responses,
    // and somebody grants Drive access they did not need to grant.
    render(<SheetSharingControl sharing={base} accountEmail="owner@acme.com" canManage />)
    expect(screen.getByText(/already read responses inside MakingFlow/i)).toBeTruthy()
  })
})
