"use server"

import { generateObject, type ModelMessage } from "ai"
import { aiEditModel, aiModel, isAiConfigured } from "@/lib/ai/provider"
import {
  aiEditSchema,
  aiVerifySchema,
  FORM_EDIT_SYSTEM,
  FORM_VERIFY_SYSTEM,
  type AiOperation,
} from "@/lib/ai/form-schema"
import {
  applyOperations,
  toEditContext,
  resolveOpRefs,
  type EditorForm,
  type FormFacts,
} from "@/lib/builder/form-model"
import { getOptionalUser } from "@/lib/auth/session"

export type AiEditSuccess = {
  summary: string
  /** The ops actually applied (first pass + any repair), for debugging/telemetry. */
  operations: AiOperation[]
  /** The fully-applied form. Applied SERVER-SIDE so newly-added fields keep the
   *  same ids the verify pass targeted — the client sets this directly. */
  form: EditorForm
}

/**
 * Turn a plain-language edit request into a list of explicit operations, apply
 * them deterministically (see applyOperations), then run a verify-and-repair
 * pass that re-reads the RESULTING form and corrects any mismatch (wrong place,
 * wrong type, missing change) before returning. Non-streaming: the form is
 * already on screen, so there's no live preview to build.
 */
export async function aiEditForm(input: {
  instruction: string
  current: EditorForm
  transcript?: { role: "user" | "assistant"; text: string }[]
  /** Hosted URL of an image the user attached to THIS turn (Cloudinary). The
   *  model cannot see the picture on this path and does not need to — it needs
   *  a URL it can put in set_theme or config.imageUrl, and inventing one is
   *  the only alternative. */
  imageUrl?: string
  /** Read-only facts (share link, publish status) so questions about the form
   *  can be answered rather than guessed at. */
  facts?: FormFacts
}): Promise<AiEditSuccess | { error: string }> {
  const user = await getOptionalUser()
  if (!user) return { error: "unauthorized" }
  if (!isAiConfigured()) return { error: "ai_unavailable" }

  const { context, refs } = toEditContext(input.current, input.facts)
  const debug = process.env.NODE_ENV === "development"

  // Diagnostic: print the refs the model can target + the ops it returns.
  if (debug) {
    console.log("\n[aiEditForm] instruction:", JSON.stringify(input.instruction))
    console.log("[aiEditForm] available refs:")
    for (const f of context.fields) {
      console.log(`  field ${f.ref} (pos ${f.pos})  "${f.label}" (${f.type})`)
      const opts = (f as { options?: { ref: string; label: string }[] }).options
      if (opts) for (const o of opts) console.log(`      option ${o.ref}  "${o.label}"`)
    }
  }

  const messages: ModelMessage[] = []
  for (const turn of input.transcript ?? []) {
    if (turn?.text) messages.push({ role: turn.role, content: turn.text })
  }
  // Stated as fact in the user turn rather than the system prompt: it is true
  // of this turn only, and the model has to quote it back verbatim.
  const attached = input.imageUrl
    ? `\n\nI attached an image to this message. Its hosted URL is ${input.imageUrl} — use exactly that URL wherever I refer to "this image" (set_theme for a logo or banner, config.imageUrl for an image block).`
    : ""

  messages.push({
    role: "user",
    content: `${input.instruction.trim()}${attached}\n\nThe current form is:\n${JSON.stringify(
      context,
    )}\n\nReturn only the operations needed for my request; leave everything else untouched.`,
  })

  try {
    // ── Pass 1: plan + operations ────────────────────────────────────────
    const { object } = await generateObject({
      model: aiEditModel,
      schema: aiEditSchema,
      system: FORM_EDIT_SYSTEM,
      messages,
      // A small temperature (not 0): greedy decoding at temp 0 can get STUCK
      // repeating the same operation thousands of times until it exhausts the
      // token budget (a 4-minute runaway seen in the wild). A little randomness
      // breaks that loop while keeping edits essentially deterministic.
      temperature: 0.15,
      // Hard ceiling so a repetition loop fails in seconds, not minutes. No real
      // edit — even renumbering a 50-field form — needs anywhere near this.
      maxOutputTokens: 8192,
    })
    if (debug) console.log("[aiEditForm] plan:", object.plan)

    // Collapse exact-duplicate operations. A confused model sometimes emits the
    // same op many times over; applying it once is correct, and this also stops
    // a partial runaway (capped mid-loop) from spamming identical no-ops.
    const firstOps = dedupeOps(object.operations).map((op) => resolveOpRefs(op, refs))
    let operations = firstOps
    let form = applyOperations(input.current, firstOps)

    // ── Pass 2: verify & repair (only when it can actually help) ──────────
    // The verify pass exists to catch a change that landed in the WRONG PLACE —
    // which only add_field / move_field can do. For everything else (required
    // flags, relabels, option edits, logic) there's no placement to get wrong,
    // so we skip the second round-trip and return immediately. This keeps a
    // trivial edit like "make Phone required" to a single fast call.
    const needsVerify = firstOps.some((op) => op.op === "add_field" || op.op === "move_field")
    if (needsVerify) {
      const repair = await verifyAndRepair(input.instruction, form, debug)
      if (repair.length > 0) {
        operations = [...firstOps, ...repair]
        form = applyOperations(form, repair)
      }
    }

    if (debug) console.log("[aiEditForm] operations:\n" + JSON.stringify(operations, null, 2))
    return { summary: object.summary, operations, form }
  } catch (err) {
    console.error("[aiEditForm] failed", err)
    return { error: "edit_failed" }
  }
}

/**
 * The verify pass: given the form after the first edit, ask a cheaper model
 * whether it satisfies the request; if not, return corrective operations
 * (already resolved to real ids). Best-effort — any failure returns no repairs
 * so the first-pass result still ships. Single pass, to bound latency/cost.
 */
async function verifyAndRepair(
  instruction: string,
  form: EditorForm,
  debug: boolean,
): Promise<AiOperation[]> {
  try {
    const { context, refs } = toEditContext(form)
    const { object } = await generateObject({
      model: aiModel,
      schema: aiVerifySchema,
      system: FORM_VERIFY_SYSTEM,
      temperature: 0.15,
      maxOutputTokens: 8192,
      messages: [
        {
          role: "user",
          content: `The user's edit request was:\n"${instruction.trim()}"\n\nThe form AFTER the edit is now:\n${JSON.stringify(
            context,
          )}\n\nDoes this fully satisfy the request? If not, return corrective operations against THIS form.`,
        },
      ],
    })
    if (debug) console.log("[aiEditForm] verify:", object.satisfied, "-", object.reasoning)
    if (object.satisfied || object.operations.length === 0) return []
    return dedupeOps(object.operations).map((op) => resolveOpRefs(op, refs))
  } catch (err) {
    // The verify pass is an enhancement, not a gate — never fail the edit over it.
    console.error("[aiEditForm] verify pass failed (keeping first-pass result)", err)
    return []
  }
}

/** Drop exact-duplicate operations (same op, same fields), preserving order.
 *  Identical ops are never intentional and are the signature of a model that
 *  looped — applying one is correct, applying 200 wastes work. */
function dedupeOps(ops: AiOperation[]): AiOperation[] {
  const seen = new Set<string>()
  const out: AiOperation[] = []
  for (const op of ops) {
    const key = JSON.stringify(op)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(op)
  }
  return out
}
