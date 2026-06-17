"use server"

import { generateObject, type ModelMessage } from "ai"
import { geminiModel } from "@/lib/ai/provider"
import { aiEditSchema, FORM_EDIT_SYSTEM, type AiEditResult } from "@/lib/ai/form-schema"
import { toEditContext, resolveOpRefs, type EditorForm } from "@/lib/builder/form-model"
import { getOptionalUser } from "@/lib/auth/session"

/**
 * Turn a plain-language edit request into a list of explicit operations against
 * the current form. The builder applies them deterministically (see
 * applyOperations), so an edit can't silently drop or garble unrelated fields —
 * unlike re-emitting the whole form. Non-streaming: edits don't need the live
 * build preview (the form is already on screen).
 */
export async function aiEditForm(input: {
  instruction: string
  current: EditorForm
  transcript?: { role: "user" | "assistant"; text: string }[]
}): Promise<AiEditResult | { error: string }> {
  const user = await getOptionalUser()
  if (!user) return { error: "unauthorized" }
  if (!process.env.GEMINI_API_KEY) return { error: "ai_unavailable" }

  const { context, refs } = toEditContext(input.current)
  const debug = process.env.NODE_ENV === "development"

  // Diagnostic: print the refs the model can target + the ops it returns.
  if (debug) {
    console.log("\n[aiEditForm] instruction:", JSON.stringify(input.instruction))
    console.log("[aiEditForm] available refs:")
    for (const f of context.fields) {
      console.log(`  field ${f.ref}  "${f.label}" (${f.type})`)
      const opts = (f as { options?: { ref: string; label: string }[] }).options
      if (opts) for (const o of opts) console.log(`      option ${o.ref}  "${o.label}"`)
    }
  }

  const messages: ModelMessage[] = []
  for (const turn of input.transcript ?? []) {
    if (turn?.text) messages.push({ role: turn.role, content: turn.text })
  }
  messages.push({
    role: "user",
    content: `${input.instruction.trim()}\n\nThe current form is:\n${JSON.stringify(
      context,
    )}\n\nReturn only the operations needed for my request; leave everything else untouched.`,
  })

  try {
    const { object } = await generateObject({
      model: geminiModel,
      schema: aiEditSchema,
      system: FORM_EDIT_SYSTEM,
      messages,
      // Deterministic structured edits — no creative drift, same input → same ops.
      temperature: 0,
    })
    // Map the model's short refs (f3, f3o2) back to the real field/option ids.
    const operations = object.operations.map((op) => resolveOpRefs(op, refs))
    if (debug)
      console.log("[aiEditForm] operations returned:\n" + JSON.stringify(operations, null, 2))
    return { ...object, operations }
  } catch (err) {
    console.error("[aiEditForm] failed", err)
    return { error: "edit_failed" }
  }
}
