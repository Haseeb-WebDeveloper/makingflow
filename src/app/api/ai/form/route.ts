import { streamObject, type ModelMessage } from "ai"
import { aiModel, aiVisionModel } from "@/lib/ai/provider"
import { aiFormSchema, FORM_BUILDER_SYSTEM, type AiForm } from "@/lib/ai/form-schema"
import { getOptionalUser } from "@/lib/auth/session"

export const maxDuration = 60

type Body = {
  instruction?: string
  /** Reference screenshot for THIS turn, as a data URL. */
  image?: string
  /** Current form state — sent on edits so the model amends from the real form. */
  current?: AiForm | null
  /** The conversation so far (user asks + assistant acks) for context. */
  transcript?: { role: "user" | "assistant"; text: string }[]
}

/**
 * Streams a form spec as the model generates it. The client (useObject) parses
 * the partial object live, so the preview builds in real time. Conversation-
 * aware: the transcript + current form give every edit full context.
 */
export async function POST(request: Request) {
  // Builders only — the proxy already requires a session cookie; this verifies it.
  const user = await getOptionalUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const { instruction, image, current, transcript }: Body = await request.json()

  if (!image && (!instruction || typeof instruction !== "string")) {
    return new Response("Provide an instruction or a reference image", { status: 400 })
  }

  // Replay the conversation so the model remembers what was asked and built.
  const messages: ModelMessage[] = []
  for (const turn of transcript ?? []) {
    if (turn?.text) messages.push({ role: turn.role, content: turn.text })
  }

  // The new turn: the instruction, the current form (for edits), and any image.
  const text =
    (instruction?.trim() ||
      "Recreate this form from the reference image. Match its fields, order, labels, and grouping as closely as the allowed field types permit.") +
    (current
      ? `\n\nThe current form is:\n${JSON.stringify(current)}\n\nApply my request and return the COMPLETE updated form — keep everything my request doesn't change.`
      : "")

  messages.push({
    role: "user",
    content: image ? [{ type: "text", text }, { type: "image", image }] : text,
  })

  // The default model is text-only — a reference screenshot has to go to the
  // multimodal one or the request hard-errors.
  const result = streamObject({
    model: image ? aiVisionModel : aiModel,
    schema: aiFormSchema,
    system: FORM_BUILDER_SYSTEM,
    messages,
  })

  return result.toTextStreamResponse()
}
