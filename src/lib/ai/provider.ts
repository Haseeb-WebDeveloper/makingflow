import { createDeepSeek } from "@ai-sdk/deepseek"

/**
 * The app's AI provider, behind a thin module so swapping vendors is one file —
 * the rest of the app imports `aiModel` / `aiFastModel` / `aiEditModel` and
 * never names a vendor. Server-only: never import this from a Client Component.
 *
 * Currently DeepSeek (`DEEPSEEK_API_KEY`). Swapping to another vendor means
 * changing the import + factory here and nothing else, as long as the new
 * provider package targets the same `@ai-sdk/provider` major as the installed
 * `ai` package — a mismatch fails at runtime with "Unsupported model version".
 */
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
})

// IMPORTANT: DeepSeek does not implement `response_format: json_schema` — the
// API rejects it outright. The AI SDK falls back to injecting the schema into
// the system message ("compatibility mode"), which works but is prompt-enforced
// rather than constrained decoding, so malformed objects are possible. Every
// generateObject/streamObject call site must stay tolerant of a schema miss.

// General-purpose default: form generation, insights, submission intelligence.
export const AI_MODEL_ID = process.env.AI_MODEL ?? "deepseek-v4-flash"

// Latency-critical, low-reasoning work (parsing a reply, phrasing one chat line
// in the conversational runtime). DeepSeek has no lighter tier than flash, so
// this is the same model for now — kept as its own export so a cheaper/faster
// model can be slotted in without touching call sites.
export const AI_FAST_MODEL_ID = process.env.AI_FAST_MODEL ?? "deepseek-v4-flash"

// Editing an existing form. Flash is accurate enough because the op schema,
// placement semantics, and the deterministic apply + verify pass do the heavy
// lifting. Set AI_EDIT_MODEL=deepseek-v4-pro for maximum reasoning on complex
// restructures, at higher cost and latency.
export const AI_EDIT_MODEL_ID = process.env.AI_EDIT_MODEL ?? "deepseek-v4-flash"

// Multimodal. The default model is TEXT-ONLY and hard-errors with "This model
// does not support image" on any image part, so the screenshot→form path must
// select this model explicitly. Kept separate rather than made the default
// because the vision tier is experimental and slower.
export const AI_VISION_MODEL_ID =
  process.env.AI_VISION_MODEL ?? "deepseek-v4-flash-vision-exp"

export const aiModel = deepseek(AI_MODEL_ID)
export const aiFastModel = deepseek(AI_FAST_MODEL_ID)
export const aiEditModel = deepseek(AI_EDIT_MODEL_ID)
export const aiVisionModel = deepseek(AI_VISION_MODEL_ID)

/**
 * AI is additive, never a hard dependency (see AGENTS.md). Call sites check this
 * and degrade gracefully — forms must still render, submit and store data with
 * no key configured. Keeping the env-var name here means swapping vendors never
 * leaves a stale key check behind in a route.
 */
export function isAiConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY)
}
