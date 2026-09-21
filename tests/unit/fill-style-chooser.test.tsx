/**
 * The fill-style chooser ("How would you like to fill this out?") is an extra
 * screen standing between a respondent and the first question, so it is OFF
 * unless the form's owner turns it on. A form should just be a form.
 *
 * `chooserEnabled` is absent on every form written before the setting existed,
 * and absent must read as off — otherwise the default silently stays "ask".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"

import type { PublicForm } from "@/lib/data/public-form"

const submitForm = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ success: true as const })))
vi.mock("@/lib/actions/submissions", () => ({ submitForm }))

const { FormRuntime } = await import("@/components/forms/form-runtime")

const PUBLIC_ID = "form-chooser-1"
const CHOOSER_HEADING = /how would you like to fill this out/i

/** Two answerable fields, so the chooser is not skipped for being pointless. */
const baseForm: PublicForm = {
  publicId: PUBLIC_ID,
  title: "Feedback",
  submitLabel: "Submit",
  thankYou: "Thanks!",
  successBody: null,
  successVideoUrl: null,
  redirectUrl: null,
  showProgressBar: false,
  chooserEnabled: false,
  chooserStyle: "cards",
  renderMode: "classic",
  baseLanguage: "en",
  ai: null,
  theme: null,
  fields: [
    { id: "f1", type: "short_text", label: "Your name", required: false },
    { id: "f2", type: "short_text", label: "Your company", required: false },
  ],
}

function formWith(patch: Partial<PublicForm>): PublicForm {
  return { ...baseForm, ...patch }
}

const quietFetch = () => vi.fn(async () => new Response(null, { status: 204 }))

beforeEach(() => {
  localStorage.clear()
  submitForm.mockClear()
  vi.stubGlobal("fetch", quietFetch())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("fill-style chooser gating", () => {
  test("off by default: the form opens all at once, with no chooser screen", async () => {
    render(<FormRuntime form={formWith({ chooserEnabled: false })} />)

    await screen.findByRole("button", { name: "Submit" })
    expect(screen.queryByText(CHOOSER_HEADING)).toBeNull()
    // Both questions are on screen at once — that IS all-at-once mode.
    expect(screen.getByText("Your name")).toBeInTheDocument()
    expect(screen.getByText("Your company")).toBeInTheDocument()
  })

  test("on: the chooser is asked before the form", async () => {
    render(<FormRuntime form={formWith({ chooserEnabled: true })} />)

    expect(await screen.findByText(CHOOSER_HEADING)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull()
  })

  test("on, but one answerable field: still skipped, nothing to step through", async () => {
    render(
      <FormRuntime
        form={formWith({
          chooserEnabled: true,
          fields: [{ id: "f1", type: "short_text", label: "Your name", required: false }],
        })}
      />,
    )

    await screen.findByRole("button", { name: "Submit" })
    expect(screen.queryByText(CHOOSER_HEADING)).toBeNull()
  })

  test("off ignores a stale one-at-a-time preference from a previous visit", async () => {
    // Someone chose "step" while the chooser was enabled; the owner has since
    // turned it off. Off means off — they must not land back in step mode.
    localStorage.setItem(`mf:fillmode:${PUBLIC_ID}`, "step")

    render(<FormRuntime form={formWith({ chooserEnabled: false })} />)

    await screen.findByRole("button", { name: "Submit" })
    await waitFor(() => expect(screen.getByText("Your company")).toBeInTheDocument())
    expect(screen.queryByText(CHOOSER_HEADING)).toBeNull()
  })
})
