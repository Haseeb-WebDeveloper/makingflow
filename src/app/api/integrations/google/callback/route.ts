import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { workspaceConnections } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { exchangeCode } from "@/lib/integrations/google"
import { encrypt, verifyState } from "@/lib/integrations/crypto"

type State = { w: string; r: string; t: number }

function back(req: NextRequest, path: string, status: "connected" | "error", reason?: string) {
  const url = new URL(path, req.url)
  url.searchParams.set("google", status)
  if (reason) url.searchParams.set("reason", reason)
  return NextResponse.redirect(url)
}

/**
 * Google redirects here after consent. We verify the signed state, re-check
 * that it matches the *current* session's workspace (state alone is never
 * trusted for tenancy), exchange the code, and upsert ONE connection row per
 * workspace + provider. Tokens are encrypted before they touch the DB.
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

  // Tenancy: the connection binds to the logged-in user's workspace, and that
  // must be the same workspace the flow was started for.
  const workspace = await getDefaultWorkspace()
  if (!workspace || workspace.id !== state.w) {
    return back(req, returnPath, "error", "workspace_mismatch")
  }

  try {
    const grant = await exchangeCode(code)

    const [existing] = await db
      .select({ id: workspaceConnections.id, refreshToken: workspaceConnections.refreshToken })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.workspaceId, workspace.id),
          eq(workspaceConnections.provider, "google"),
        ),
      )
      .limit(1)

    const values = {
      workspaceId: workspace.id,
      provider: "google" as const,
      accountEmail: grant.email ?? "Google account",
      accessToken: encrypt(grant.accessToken),
      // Google omits the refresh token on re-consent if one was already issued;
      // keep the stored one rather than nulling it out.
      refreshToken: grant.refreshToken
        ? encrypt(grant.refreshToken)
        : (existing?.refreshToken ?? null),
      expiresAt: grant.expiresAt,
      scopes: grant.scopes,
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
    console.error("[google callback] failed", err)
    return back(req, returnPath, "error", "exchange_failed")
  }

  return back(req, returnPath, "connected")
}
