import { NextResponse, type NextRequest } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { buildConsentUrl, isNotionConfigured } from "@/lib/integrations/notion"
import { signState } from "@/lib/integrations/crypto"

/**
 * Start the Notion connect flow for the caller's workspace. Auth-gated; the
 * signed `state` carries the workspace + the page to return to, so the callback
 * can't be tricked into binding a grant to another tenant.
 */
export async function GET(req: NextRequest) {
  if (!isNotionConfigured()) {
    return NextResponse.json({ error: "Notion integration is not configured" }, { status: 503 })
  }

  const workspace = await getDefaultWorkspace()
  if (!workspace) return NextResponse.redirect(new URL("/auth/login", req.url))

  const formId = req.nextUrl.searchParams.get("formId")
  let returnPath = "/integrations"
  if (formId) {
    const [form] = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt)))
      .limit(1)
    if (form) returnPath = `/forms/${formId}/integrations`
  }

  const state = signState({ w: workspace.id, r: returnPath, t: Date.now() })
  return NextResponse.redirect(buildConsentUrl(state))
}
