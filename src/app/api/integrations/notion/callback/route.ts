import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaceConnections } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { exchangeCode } from "@/lib/integrations/notion"
import { encrypt, verifyState } from "@/lib/integrations/crypto"

type State = { w: string; r: string; t: number }

function back(req: NextRequest, path: string, status: "connected" | "error", reason?: string) {
  const url = new URL(path, req.url)
  url.searchParams.set("notion", status)
  if (reason) url.searchParams.set("reason", reason)
  return NextResponse.redirect(url)
}

/**
 * Notion redirects here after consent. We verify the signed state, re-check that
 * it matches the *current* session's workspace, exchange the code, and upsert ONE
 * connection row per workspace + provider. The bot token is encrypted at rest.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const stateRaw = params.get("state")
  const state = stateRaw ? verifyState<State>(stateRaw) : null
  const returnPath = state?.r ?? "/integrations"

  if (params.get("error")) {
    return back(req, returnPath, "error", "denied")
  }
  const code = params.get("code")
  if (!code || !state) {
    return back(req, returnPath, "error", "invalid_request")
  }

  const workspace = await getDefaultWorkspace()
  if (!workspace || workspace.id !== state.w) {
    return back(req, returnPath, "error", "workspace_mismatch")
  }

  try {
    const grant = await exchangeCode(code)

    const [existing] = await db
      .select({ id: workspaceConnections.id, metadata: workspaceConnections.metadata })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, workspace.id),
          eq(workspaceConnections.provider, "notion"),
        ),
      )
      .limit(1)

    const values = {
      workspaceId: workspace.id,
      provider: "notion" as const,
      accountEmail: grant.workspaceName ?? "Notion workspace",
      accessToken: encrypt(grant.accessToken),
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      metadata: {
        notion: {
          // Keep the existing parent page on reconnect so we don't orphan it.
          parentPageId: existing?.metadata?.notion?.parentPageId,
          workspaceId: grant.notionWorkspaceId ?? undefined,
          botId: grant.botId ?? undefined,
        },
      },
    }

    if (existing) {
      await db
        .update(workspaceConnections)
        .set(values)
        .where(eq(workspaceConnections.id, existing.id))
    } else {
      await db.insert(workspaceConnections).values(values)
    }
  } catch (err) {
    console.error("[notion callback] failed", err)
    return back(req, returnPath, "error", "exchange_failed")
  }

  return back(req, returnPath, "connected")
}
