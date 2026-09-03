/**
 * Graceful degradation when the model fails mid-turn.
 *
 * The turn endpoint streams. `streamText` sends 200 with the turn headers
 * before it reaches the model, so a failure — an outage, or a drained API
 * balance answering 402 — does NOT come back as an error status. It comes back
 * as a stream that closes having produced nothing, and every transport check
 * passes. The opening turn is the exposed one: it has no reply to parse, so the
 * un-throwable streaming call is the only model call it makes.
 *
 * Left unguarded, the respondent got an empty chat bubble and a text box: no
 * question, no error, and no fall back to the classic form.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { PublicForm } from "@/lib/data/public-form"
import type { TurnMeta } from "@/lib/forms/conversation-types"

const submitForm = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ success: true as const })))
vi.mock("@/lib/actions/submissions", () => ({ submitForm }))

const { ConversationalRuntime } = await import("@/components/forms/conversational-runtime")

const FIELD_ID = "field-name"

const form: PublicForm = {
  publicId: "conv-form-1",
  title: "Tell us about your project",
  submitLabel: "Submit",
  thankYou: "Thanks, we have it.",
  successBody: null,
  successVideoUrl: null,
  redirectUrl: null,
  showProgressBar: false,
  chooserStyle: "cards",
  renderMode: "conversational",
  baseLanguage: "en",
  ai: { enabled: true, followUpsEnabled: false, clarifyVagueAnswers: false, persona: null },
  theme: null,
  fields: [{ id: FIELD_ID, type: "short_text", label: "Your name", required: false }],
}

/** A turn response shaped exactly like the route's: text stream + meta header. */
function turnResponse(text: string, meta: TurnMeta) {
  return new Response(
    new ReadableStream({
      start(c) {
        if (text) c.enqueue(new TextEncoder().encode(text))
        c.close()
      },
    }),
    { status: 200, headers: { "x-mf-turn": encodeURIComponent(JSON.stringify(meta)) } },
  )
}

function mockFetch(turn: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("/api/forms/turn")) return turn()
    if (url.startsWith("/api/partial")) {
      return new Response(JSON.stringify({ values: {} }), { status: 200 })
    }
    return new Response(null, { status: 204 })
  })
}

beforeEach(() => {
  localStorage.clear()
  submitForm.mockClear()
})
afterEach(() => {
  cleanup() // vitest runs with globals:false, so testing-library never auto-cleans
  vi.unstubAllGlobals()
})

const ADVANCE: TurnMeta = {
  action: "advance",
  expect: { kind: "field", fieldId: FIELD_ID },
  parsedFieldId: null,
  parsedValue: null,
  language: null,
}

describe("ConversationalRuntime — model failure mid-stream", () => {
  test("an opening turn that streams nothing falls back to the classic form", async () => {
    // 200 OK, correct headers, empty body — what a drained balance looks like.
    vi.stubGlobal("fetch", mockFetch(() => turnResponse("", ADVANCE)))

    render(<ConversationalRuntime form={form} />)

    // The classic runtime is now on screen: a real question and a Submit button.
    expect(await screen.findByRole("button", { name: "Submit" })).toBeInTheDocument()
    expect(screen.getByText("Your name")).toBeInTheDocument()
  })

  test("a healthy turn still renders the conversation", async () => {
    vi.stubGlobal("fetch", mockFetch(() => turnResponse("Hi! What's your name?", ADVANCE)))

    render(<ConversationalRuntime form={form} />)

    expect(await screen.findByText("Hi! What's your name?")).toBeInTheDocument()
    // Still the chat — not degraded.
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull()
  })

  test("an empty CLOSING turn still submits instead of bouncing to a fresh form", async () => {
    // Every answer is already collected here, so degrading would throw the
    // conversation away. applyMeta substitutes a closing line and finishes.
    const done: TurnMeta = {
      action: "done",
      expect: { kind: "done" },
      parsedFieldId: null,
      parsedValue: null,
      language: null,
    }
    vi.stubGlobal("fetch", mockFetch(() => turnResponse("", done)))

    render(<ConversationalRuntime form={form} />)

    await waitFor(() => expect(submitForm).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Thanks, we have it.")).toBeInTheDocument()
  })

  test("a 503 from the turn endpoint also falls back", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })),
    )

    render(<ConversationalRuntime form={form} />)
    expect(await screen.findByRole("button", { name: "Submit" })).toBeInTheDocument()
  })
})
