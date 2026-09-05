import "server-only"

/**
 * The consent record: what a connected app may reach, and for whom.
 *
 * This is the OAuth counterpart of `mcp_key_workspaces`, and it exists for the
 * same reason. A credential proves WHO is calling. It never decides WHAT they
 * may do — that is re-read from rows we control, on every request, and
 * intersected with live workspace membership. The grant can lose reach; it can
 * never gain it.
 *
 * Which makes the token's job small: subject and client, bound to our resource.
 * Everything else is here. A user removed from a workspace this morning still
 * holds a valid token minted last week, and this is what makes that harmless.
 *
 * IDENTITY MAPPING. The authorization server's `sub` is not our `users.id`. With
 * Standalone Connect the user authenticates against Supabase first and we hand
 * the AS an `external_auth_id` — our id — so `sub` comes back as that. This
 * module treats the mapping as one lookup with a single rule: no user row, no
 * principal. It never creates a user from a token, because a token from a
 * misconfigured issuer would then mint accounts.
 */

import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  mcpOauthGrantWorkspaces,
  mcpOauthGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema"
import { isScope, type Role, type Scope } from "@/lib/auth/context"
import type { GrantedWorkspace } from "@/lib/mcp/auth"
import type { VerifiedToken } from "@/lib/mcp/oauth/verify"

/** Where a user finishes setting up a connection. Named in refusal messages. */
function settingsUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || ""
  return `${base}/integrations`
}

export type ResolvedGrant = {
  grantId: string
  userId: string
  scopes: ReadonlySet<Scope>
  workspaces: GrantedWorkspace[]
}

export type GrantFailure = { ok: false; status: 401 | 403; error: string }
export type GrantResult = { ok: true; grant: ResolvedGrant } | GrantFailure

/**
 * Resolve a verified token to the standing grant behind it.
 *
 * Every refusal is deliberate about its status: 401 means "this credential is no
 * good, get another", which a client answers by re-authorising; 403 means "the
 * credential is fine, the access is not", which re-authorising will not fix.
 * Getting that backwards sends clients into a re-auth loop that cannot succeed.
 */
export async function grantForToken(token: VerifiedToken): Promise<GrantResult> {
  // The subject is our own user id, handed to the AS as external_auth_id. It is
  // still checked against a real row: a token from a misconfigured issuer must
  // not conjure a principal for an id that no longer exists.
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, token.subject))
    .limit(1)
  if (!user) return { ok: false, status: 401, error: "Unknown account" }

  const [grant] = await db
    .select({
      id: mcpOauthGrants.id,
      scopes: mcpOauthGrants.scopes,
      revokedAt: mcpOauthGrants.revokedAt,
    })
    .from(mcpOauthGrants)
    .where(
      and(
        eq(mcpOauthGrants.userId, user.id),
        // Bound to the CLIENT, not just the user. Without this, a token issued
        // to one connected app would ride on the consent given to another.
        eq(mcpOauthGrants.clientId, token.clientId),
      ),
    )
    .limit(1)

  if (!grant) {
    // A verified token for a client we never saw at consent time.
    //
    // This is the normal path when the authorization server's Login URI does
    // not forward `client_id` — we could not ask which workspaces before the
    // app connected, because we did not yet know which app was asking. Guessing
    // is not an option: a grant bound to the wrong client would let one
    // connected app act through another's permissions.
    //
    // So the grant is created here, empty, and the user finishes the job. That
    // makes the app visible in /integrations immediately rather than leaving
    // them with a failing assistant and nothing to click.
    await db
      .insert(mcpOauthGrants)
      .values({ userId: user.id, clientId: token.clientId, scopes: [] })
      .onConflictDoNothing()

    return {
      ok: false,
      status: 403,
      error: `This app isn't set up yet. Open ${settingsUrl()} and choose which workspaces it may reach.`,
    }
  }
  if (grant.revokedAt) {
    // Deliberately NOT re-created above: the row exists, and the user put it in
    // this state on purpose. Auto-reviving a revoked grant on the next request
    // would make disconnecting an app do nothing.
    return { ok: false, status: 401, error: "Access for this app has been revoked" }
  }

  const granted = await db
    .select({ workspaceId: mcpOauthGrantWorkspaces.workspaceId })
    .from(mcpOauthGrantWorkspaces)
    .where(eq(mcpOauthGrantWorkspaces.grantId, grant.id))
  if (granted.length === 0) {
    // Either the placeholder above, still unfinished, or a grant whose every
    // workspace has since been deleted. Same message: the fix is the same page.
    return {
      ok: false,
      status: 403,
      error: `This app isn't set up yet. Open ${settingsUrl()} and choose which workspaces it may reach.`,
    }
  }

  // THE ACCESS CHECK, identical in spirit to the API-key path: the consented
  // list is intersected with live membership, so a workspace the user has since
  // left drops out here rather than being trusted because it was granted once.
  const reachable = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      plan: workspaces.plan,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, user.id),
        inArray(
          workspaceMembers.workspaceId,
          granted.map((g) => g.workspaceId),
        ),
      ),
    )

  if (reachable.length === 0) {
    return { ok: false, status: 403, error: "This app's workspace access has been removed" }
  }

  return {
    ok: true,
    grant: {
      grantId: grant.id,
      userId: user.id,
      scopes: new Set(grant.scopes.filter(isScope)),
      workspaces: reachable.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role as Role,
        plan: w.plan,
      })),
    },
  }
}

export type ConsentInput = {
  userId: string
  clientId: string
  clientName: string | null
  scopes: Scope[]
  workspaceIds: string[]
}

/**
 * Record (or re-record) a user's consent for one client.
 *
 * Re-consenting REPLACES rather than accumulates. A client the user re-authorises
 * with fewer workspaces must end up with fewer, and a union would quietly turn
 * every re-consent into a widening — the opposite of what the user just did.
 *
 * The workspace list is filtered against live membership here as well as at read
 * time. Checking twice is not redundant: this stops a tampered consent form from
 * writing a workspace the user was never in, so the row on disk is never a lie
 * even though the read path would also refuse it.
 */
export async function recordConsent(input: ConsentInput): Promise<{ grantId: string }> {
  const memberOf = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, input.userId),
        inArray(workspaceMembers.workspaceId, input.workspaceIds),
      ),
    )
  if (memberOf.length === 0) {
    throw new Error("Consent named no workspace the user belongs to")
  }

  return db.transaction(async (tx) => {
    const [grant] = await tx
      .insert(mcpOauthGrants)
      .values({
        userId: input.userId,
        clientId: input.clientId,
        clientName: input.clientName,
        scopes: input.scopes,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: [mcpOauthGrants.userId, mcpOauthGrants.clientId],
        set: {
          clientName: input.clientName,
          scopes: input.scopes,
          // Re-consenting un-revokes: the user is, right now, saying yes again.
          revokedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: mcpOauthGrants.id })

    await tx
      .delete(mcpOauthGrantWorkspaces)
      .where(eq(mcpOauthGrantWorkspaces.grantId, grant.id))
    await tx.insert(mcpOauthGrantWorkspaces).values(
      memberOf.map((m) => ({ grantId: grant.id, workspaceId: m.workspaceId })),
    )

    return { grantId: grant.id }
  })
}

export type ConnectedApp = {
  id: string
  clientId: string
  clientName: string | null
  scopes: string[]
  workspaces: { id: string; name: string }[]
  lastUsedAt: Date | null
  createdAt: Date
}

/** The apps a user has connected, for the "manage access" list. */
export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const rows = await db
    .select({
      id: mcpOauthGrants.id,
      clientId: mcpOauthGrants.clientId,
      clientName: mcpOauthGrants.clientName,
      scopes: mcpOauthGrants.scopes,
      lastUsedAt: mcpOauthGrants.lastUsedAt,
      createdAt: mcpOauthGrants.createdAt,
    })
    .from(mcpOauthGrants)
    .where(and(eq(mcpOauthGrants.userId, userId), isNull(mcpOauthGrants.revokedAt)))
    .orderBy(mcpOauthGrants.createdAt)
  if (rows.length === 0) return []

  const scoped = await db
    .select({
      grantId: mcpOauthGrantWorkspaces.grantId,
      id: workspaces.id,
      name: workspaces.name,
    })
    .from(mcpOauthGrantWorkspaces)
    .innerJoin(workspaces, eq(workspaces.id, mcpOauthGrantWorkspaces.workspaceId))
    .where(
      inArray(
        mcpOauthGrantWorkspaces.grantId,
        rows.map((r) => r.id),
      ),
    )

  const byGrant = new Map<string, { id: string; name: string }[]>()
  for (const row of scoped) {
    const list = byGrant.get(row.grantId) ?? []
    list.push({ id: row.id, name: row.name })
    byGrant.set(row.grantId, list)
  }

  return rows.map((r) => ({ ...r, workspaces: byGrant.get(r.id) ?? [] }))
}

/**
 * Revoke a grant.
 *
 * Marked rather than deleted, so the audit trail's `grant_id` still resolves to
 * something — an append-only record of what an app did is worth little if
 * disconnecting the app erases who it was. Verification refuses a revoked row on
 * the very next request; there is no token to chase down.
 */
export async function revokeGrant(userId: string, grantId: string): Promise<boolean> {
  const revoked = await db
    .update(mcpOauthGrants)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    // Scoped to the owner: a grant id is not a capability.
    .where(and(eq(mcpOauthGrants.id, grantId), eq(mcpOauthGrants.userId, userId)))
    .returning({ id: mcpOauthGrants.id })
  return revoked.length > 0
}

/** Record that a grant was used. Best-effort and off the hot path. */
export async function touchGrant(grantId: string): Promise<void> {
  try {
    await db
      .update(mcpOauthGrants)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpOauthGrants.id, grantId))
  } catch {
    // A failed bookkeeping write must never fail the tool call it describes.
  }
}
