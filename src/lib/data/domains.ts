import { cacheLife, cacheTag } from "next/cache"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { customDomains, forms, type DomainVerification } from "@/lib/db/schema"
import { isVercelConfigured, VERCEL_CNAME_TARGET } from "@/lib/domains/vercel"

export type WorkspaceDomain = {
  id: string
  domain: string
  status: "pending" | "active" | "error"
  verification: DomainVerification[]
  formsCount: number
}

export type WorkspaceDomains = {
  configured: boolean
  cnameTarget: string
  domains: WorkspaceDomain[]
}

/** All custom domains in the caller's workspace, with how many forms use each. */
export async function getWorkspaceDomains(
  workspaceId: string,
): Promise<WorkspaceDomains | null> {

  const rows = await db
    .select({
      id: customDomains.id,
      domain: customDomains.domain,
      status: customDomains.status,
      verification: customDomains.verification,
      formsCount: sql<number>`(
        select count(*)::int from ${forms}
        where ${forms.customDomainId} = ${customDomains.id} and ${forms.deletedAt} is null
      )`,
    })
    .from(customDomains)
    .where(eq(customDomains.workspaceId, workspaceId))
    .orderBy(desc(customDomains.createdAt))

  return {
    configured: isVercelConfigured(),
    cnameTarget: VERCEL_CNAME_TARGET,
    domains: rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      status: r.status,
      verification: r.verification ?? [],
      formsCount: r.formsCount,
    })),
  }
}

/** Active domains a form can be published to (for the form's domain picker).
 *  Runs in the form-detail layout; cached per workspace and invalidated by
 *  `updateTag(workspace-domains-${id})` on any domain add/check/remove. */
export async function getActiveDomains(
  workspaceId: string,
): Promise<{ id: string; domain: string }[]> {
  "use cache"
  cacheLife("minutes")
  cacheTag(`workspace-domains-${workspaceId}`)
  return db
    .select({ id: customDomains.id, domain: customDomains.domain })
    .from(customDomains)
    .where(and(eq(customDomains.workspaceId, workspaceId), eq(customDomains.status, "active")))
    .orderBy(customDomains.domain)
}
