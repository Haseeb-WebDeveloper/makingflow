import { and, eq, isNull, sql } from "drizzle-orm"
import { updateTag } from "next/cache"
import { db } from "@/lib/db"
import { forms, formFields } from "@/lib/db/schema"
import { getOptionalUser, getDefaultWorkspace } from "@/lib/auth/session"
import { DEFAULT_FORM_TITLE } from "@/lib/builder/form-model"

/**
 * Discard an abandoned empty draft form. Called from the builder when the user
 * leaves a brand-new form they never filled in (SPA navigation or `pagehide`
 * with `keepalive`). The server is the source of truth: it only soft-deletes a
 * form that is genuinely empty — owned by the workspace, still a `draft`, still
 * named the default, and with zero fields — so a form that gained any content
 * (or was published) is never removed, even if the client misfires.
 */
export async function DELETE(request: Request) {
  const user = await getOptionalUser()
  if (!user) return new Response(null, { status: 401 })
  const workspace = await getDefaultWorkspace()
  if (!workspace) return new Response(null, { status: 403 })

  let formId: string | undefined
  try {
    ;({ formId } = (await request.json()) as { formId?: string })
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!formId) return new Response(null, { status: 400 })

  // Has it gained any fields? If so it's a real form — leave it.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
  if (n > 0) return Response.json({ deleted: false })

  const result = await db
    .update(forms)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(forms.id, formId),
        eq(forms.workspaceId, workspace.id),
        eq(forms.status, "draft"),
        eq(forms.title, DEFAULT_FORM_TITLE),
        isNull(forms.deletedAt),
      ),
    )
    .returning({ id: forms.id })

  const deleted = result.length > 0
  if (deleted) {
    updateTag(`form-${formId}`)
    updateTag(`workspace-forms-${workspace.id}`)
  }
  return Response.json({ deleted })
}
