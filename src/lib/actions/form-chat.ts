"use server"

import { z } from "zod"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { formChatMessages, forms } from "@/lib/db/schema"
import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"

type AppendResult = { success: true; id: string } | { success: false; error: string }

// A turn is one chat bubble, not a document. The cap keeps a runaway model reply
// (or a paste-bomb) from bloating every subsequent thread read; the builder's
// own summaries are 1-2 lines.
const MAX_TEXT = 8000

const AppendSchema = z.object({
  formId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(MAX_TEXT),
  imageUrl: z.string().url().nullish(),
})

/**
 * Append one turn to a form's shared AI conversation.
 *
 * Called from the builder for BOTH sides of the exchange, and from all three
 * response paths (streaming generation, operation-based edit, and the
 * deterministic fast path) — one write path instead of three.
 *
 * The author is stamped from the session, never taken from the client, so a
 * caller can't attribute a message to someone else.
 */
export async function appendFormChatMessage(input: {
  formId: string
  role: "user" | "assistant"
  text: string
  imageUrl?: string | null
}): Promise<AppendResult> {
  const parsed = AppendSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Invalid message" }
  const { formId, role, text, imageUrl } = parsed.data

  // An assistant turn with no text and no image carries nothing — skip rather
  // than persist an empty bubble that would render as a blank row forever.
  if (!text.trim() && !imageUrl) return { success: false, error: "Empty message" }

  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  // Tenancy gate — same shape as saveAiForm: prove the form is ours before
  // writing anything attached to it.
  const [owned] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(
      and(
        eq(forms.id, formId),
        eq(forms.workspaceId, workspace.id),
        isNull(forms.deletedAt),
      ),
    )
    .limit(1)
  if (!owned) return { success: false, error: "Form not found" }

  try {
    const [created] = await db
      .insert(formChatMessages)
      .values({
        formId,
        // Assistant turns have no author — the label would be meaningless.
        userId: role === "user" ? user.id : null,
        role,
        text,
        imageUrl: imageUrl ?? null,
      })
      .returning({ id: formChatMessages.id })
    return { success: true, id: created.id }
  } catch (err) {
    console.error("[appendFormChatMessage] failed", err)
    return { success: false, error: "Could not save the message" }
  }
}
