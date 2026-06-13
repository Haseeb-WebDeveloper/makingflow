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

export const geminiModel = google(GEMINI_MODEL_ID)

export { google }
