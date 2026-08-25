import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { formChatMessages, forms, users } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"

export type FormChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  imageUrl: string | null
  /** Author of a user turn. Null for assistant turns and deleted accounts. */
  authorId: string | null
  authorName: string | null
  authorAvatarUrl: string | null
}

/**
 * The shared AI conversation for one form, oldest first.
 *
 * NOT cached: the thread is mutable, read once per editor open, and scoped to
 * the caller's workspace via cookies — the same dynamic pattern as
 * `getFormForEdit` in ./forms.ts. Caching it would risk showing one tenant's
 * thread to another.
 *
 * Returns [] when the form isn't in the caller's workspace, so a wrong/guessed
 * form id reveals nothing (never distinguish "no messages" from "not yours").
 */
export async function getFormChat(formId: string): Promise<FormChatMessage[]> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return []

  // Tenancy gate: prove the form belongs to this workspace BEFORE reading any
  // of its messages.
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
  if (!owned) return []

  const rows = await db
    .select({
      id: formChatMessages.id,
      role: formChatMessages.role,
      text: formChatMessages.text,
      imageUrl: formChatMessages.imageUrl,
      authorId: formChatMessages.userId,
      authorName: users.name,
      authorEmail: users.email,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(formChatMessages)
    .leftJoin(users, eq(users.id, formChatMessages.userId))
    .where(eq(formChatMessages.formId, formId))
    // seq, not createdAt: see the column comment in schema.ts — same-transaction
    // writes share a timestamp, so ordering by it can invert a question and its
    // answer.
    .orderBy(asc(formChatMessages.seq))

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    text: r.text,
    imageUrl: r.imageUrl,
    authorId: r.authorId,
    // Fall back to the email local-part so a teammate who never set a name is
    // still identifiable in a shared thread.
    authorName: r.authorName?.trim() || r.authorEmail?.split("@")[0] || null,
    authorAvatarUrl: r.authorAvatarUrl,
  }))
}
