/**
 * Two respondent-facing behaviours that nothing else covers.
 *
 * 1. The resume prompt. A saved draft is now OFFERED, never applied on load —
 *    the token is keyed by form, not by person, so on a shared device the
 *    answers on screen might belong to whoever used the browser last.
 *
 * 2. The conversational hand-off. When the AI layer degrades mid-session the
 *    classic runtime takes over, and it has to carry everything the chat
 *    collected: the parsed answers, the draft row they belong to, the language,
 *    and the AI follow-up answers — which map to no form field and so were
 *    being dropped entirely.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { PublicForm } from "@/lib/data/public-form"
import { writeDraftToken } from "@/lib/forms/client-meta"

const submitForm = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({ success: true as const })),
)
vi.mock("@/lib/actions/submissions", () => ({ submitForm }))

const { FormRuntime } = await import("@/components/forms/form-runtime")

const FIELD_ID = "field-name"
const PUBLIC_ID = "form-public-1"

const form: PublicForm = {
  publicId: PUBLIC_ID,
  title: "Feedback",
  submitLabel: "Submit",
  thankYou: "Thanks!",
  successBody: null,
  successVideoUrl: null,
  redirectUrl: null,
  showProgressBar: false,
  chooserStyle: "cards",
  renderMode: "classic",
  baseLanguage: "en",
  ai: null,
  theme: null,
  // One answerable field, so the fill-style chooser is skipped and the test can
  // focus on the behaviour under test.
  fields: [{ id: FIELD_ID, type: "short_text", label: "Your name", required: false }],
}

/** Routes the two endpoints the runtime touches; everything else 204s. */
function mockFetch(draftValues?: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith("/api/partial") && init?.method !== "POST") {
      return new Response(JSON.stringify({ values: draftValues ?? {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.startsWith("/api/partial")) {
      return new Response(JSON.stringify({ submissionId: "draft-1" }), { status: 200 })
    }
    return new Response(null, { status: 204 })
  })
}

beforeEach(() => {
  localStorage.clear()
  submitForm.mockClear()
  // jsdom ships neither of these, and framer-motion / the runtime use both.
  window.matchMedia ??= ((q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
  window.scrollTo = vi.fn() as typeof window.scrollTo
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  // The vitest config runs with `globals: false`, so testing-library never
  // registers its own auto-cleanup — without this, each render stays in the
  // document and later `screen` queries match the previous test's markup.
  cleanup()
  vi.unstubAllGlobals()
})

describe("FormRuntime — resume prompt", () => {
  test("a saved draft is offered, not silently applied", async () => {
    writeDraftToken(PUBLIC_ID, "draft-1")
    vi.stubGlobal("fetch", mockFetch({ [FIELD_ID]: "Ada" }))

    render(<FormRuntime form={form} />)

    await screen.findByText(/continue where you left off/i)
    // The previous person's answer must not be on screen behind the prompt.
    expect(screen.queryByDisplayValue("Ada")).toBeNull()
  })

  test("Continue restores the draft", async () => {
    writeDraftToken(PUBLIC_ID, "draft-1")
    vi.stubGlobal("fetch", mockFetch({ [FIELD_ID]: "Ada" }))

    render(<FormRuntime form={form} />)
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }))

    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument()
  })

  test("Start fresh discards the draft and its token", async () => {
    writeDraftToken(PUBLIC_ID, "draft-1")
    vi.stubGlobal("fetch", mockFetch({ [FIELD_ID]: "Ada" }))

    render(<FormRuntime form={form} />)
    fireEvent.click(await screen.findByRole("button", { name: /start fresh/i }))

    await waitFor(() => expect(screen.queryByText(/continue where you left off/i)).toBeNull())
    expect(screen.queryByDisplayValue("Ada")).toBeNull()
    // The token is gone, so the next visitor is not asked about it again.
    expect(localStorage.getItem(`mf:resume:${PUBLIC_ID}`)).toBeNull()
  })

  test("no saved draft means no prompt", async () => {
    vi.stubGlobal("fetch", mockFetch())
    render(<FormRuntime form={form} />)
    await screen.findByRole("button", { name: "Submit" })
    expect(screen.queryByText(/continue where you left off/i)).toBeNull()
  })
})

describe("FormRuntime — conversational hand-off", () => {
  test("carries the chat's answers, follow-ups, language and draft row into submit", async () => {
    vi.stubGlobal("fetch", mockFetch())

    render(
      <FormRuntime
        form={form}
        initialValues={{ [FIELD_ID]: "Ada Lovelace" }}
        initialSubmissionId="draft-from-chat"
        extraAnswers={[
          {
            fieldId: null,
            value: "Because a friend recommended it",
            isAiFollowUp: true,
            question: "What made you get in touch?",
            type: "long_text",
          },
        ]}
        answerMeta={{
          [FIELD_ID]: { originalValue: "Ada Lovelace", originalLanguage: "fr" },
        }}
        language="fr"
      />,
    )

    // The chat's answers are already in the form — no prompt, no re-fetch.
    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeInTheDocument()
    expect(screen.queryByText(/continue where you left off/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Submit" }))

    await waitFor(() => expect(submitForm).toHaveBeenCalledTimes(1))
    const payload = submitForm.mock.calls[0][0] as Parameters<
      typeof import("@/lib/actions/submissions").submitForm
    >[0]


    expect(payload.publicId).toBe(PUBLIC_ID)
    // Promotes the draft the conversation already opened, rather than opening a second row.
    expect(payload.submissionId).toBe("draft-from-chat")
    expect(payload.language).toBe("fr")

    const field = payload.answers.find((a) => a.fieldId === FIELD_ID)
    expect(field?.value).toBe("Ada Lovelace")
    expect(field?.originalLanguage).toBe("fr")

    // The follow-up: no field id, flagged, question text preserved.
    const followUp = payload.answers.find((a) => a.isAiFollowUp)
    expect(followUp).toMatchObject({
      fieldId: null,
      question: "What made you get in touch?",
      value: "Because a friend recommended it",
    })
  })
})
