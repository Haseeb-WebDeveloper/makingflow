import { createGoogleGenerativeAI } from "@ai-sdk/google"

/**
 * Google Gemini provider for the Vercel AI SDK. Reads our own `GEMINI_API_KEY`
 * (the AI SDK would otherwise look for GOOGLE_GENERATIVE_AI_API_KEY). Server-only
 * — never import this from a Client Component.
 *
 * Behind a thin module so swapping providers later (e.g. Claude, if a key
 * appears) is one file — the rest of the app imports `geminiModel`/`google`.
 */
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
})

// Fast model is the right default for a live-streaming builder. Override via env
// (e.g. a Pro model for higher-quality generation). Confirm IDs against the live
// model list — the Gemini lineup moves.
export const GEMINI_MODEL_ID = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"

// Latency-critical, low-reasoning tasks (parsing a reply, phrasing one chat
// line). flash-lite returns a first token in ~0.8s vs ~4.3s for 2.5-flash with
// its default "thinking" pass — measured against the live API. flash-lite has
// no thinking step, so nothing to disable.
export const GEMINI_FAST_MODEL_ID =
  process.env.GEMINI_FAST_MODEL ?? "gemini-2.5-flash-lite"

// Editing an existing form. Flash (with its thinking pass) is accurate enough
// now that the op schema, placement semantics, and deterministic apply + verify
// pass do the heavy lifting — and it's ~3x faster than Pro, which matters since
// edits aren't streamed and users wait on them. Override to a Pro model via env
// if you want maximum reasoning on complex restructures.
export const GEMINI_EDIT_MODEL_ID = process.env.GEMINI_EDIT_MODEL ?? "gemini-2.5-flash"

export const geminiModel = google(GEMINI_MODEL_ID)
export const geminiFastModel = google(GEMINI_FAST_MODEL_ID)
export const geminiEditModel = google(GEMINI_EDIT_MODEL_ID)

// Turn OFF Gemini 2.5 "thinking" for calls that don't need chain-of-thought.
// Default thinking adds ~3s before the first token (measured). Use on 2.5-flash
// calls where the data is already supplied and the task is summarize/extract.
export const NO_THINKING = {
  google: { thinkingConfig: { thinkingBudget: 0 } },
} as const

export { google }
